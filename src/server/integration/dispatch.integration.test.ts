import { beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import { parseDateOnly } from "@/lib/dates";
import type { ServiceActor } from "@/server/actor";
import {
  autoAssign,
  findSlot,
  getCapacityOverview,
  getDispatchExceptionCounts,
  saveTerritory,
  scoreCandidates,
} from "@/server/dispatch";

const describeIntegration = integrationEnabled ? describe : describe.skip;

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "dispatch-actor",
    name: "Dispatch Test",
    email: "dispatch@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: {
      permissions: [
        "workorders.view",
        "workorders.assign",
        "workorders.edit",
        "dispatch.configure",
      ],
    },
    ...overrides,
  };
}

describeIntegration("dispatch-intelligens", () => {
  let departmentId = "";
  let workOrderId = "";
  let visitId = "";
  let technicianId = "";
  let absentTechnicianId = "";
  let skillId = "";
  let office: ServiceActor;

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-dispatch-avd") },
    });
    departmentId = department.id;
    office = actor({ departmentId });

    const skill = await prisma.skill.create({
      data: { key: unique("dispatch-skill"), label: unique("Kompetanse") },
    });
    skillId = skill.id;

    const [tech, absent] = await Promise.all([
      prisma.user.create({
        data: {
          name: unique("IT-dispatch-tekniker"),
          email: `${unique("dispatch-tech")}@example.test`,
          role: "TECHNICIAN",
          isActive: true,
          departmentId,
          skills: { create: [{ skillId }] },
          availability: {
            create: [
              { weekday: 0, startMinute: 8 * 60, endMinute: 16 * 60 },
              { weekday: 1, startMinute: 8 * 60, endMinute: 16 * 60 },
              { weekday: 2, startMinute: 8 * 60, endMinute: 16 * 60 },
              { weekday: 3, startMinute: 8 * 60, endMinute: 16 * 60 },
              { weekday: 4, startMinute: 8 * 60, endMinute: 16 * 60 },
            ],
          },
        },
      }),
      prisma.user.create({
        data: {
          name: unique("IT-dispatch-syk"),
          email: `${unique("dispatch-sick")}@example.test`,
          role: "TECHNICIAN",
          isActive: true,
          departmentId,
          skills: { create: [{ skillId }] },
          absences: {
            create: [
              {
                startsAt: new Date("2026-11-02T07:00:00.000Z"),
                endsAt: new Date("2026-11-02T18:00:00.000Z"),
                kind: "SYKDOM",
              },
            ],
          },
        },
      }),
    ]);
    technicianId = tech.id;
    absentTechnicianId = absent.id;

    const workOrder = await prisma.workOrder.create({
      data: {
        title: unique("IT-dispatch-oppdrag"),
        departmentId,
        status: "PLANNED",
        latitude: 59.91,
        longitude: 10.75,
        skillRequirements: { create: [{ skillId, mandatory: true }] },
        visits: {
          create: [
            {
              startsAt: new Date("2026-11-02T09:00:00.000Z"),
              endsAt: new Date("2026-11-02T11:00:00.000Z"),
            },
          ],
        },
      },
      include: { visits: true },
    });
    workOrderId = workOrder.id;
    visitId = workOrder.visits[0].id;
  });

  it("ekskluderer fravær og gir en deterministisk rangering", async () => {
    const first = await scoreCandidates(office, visitId, {
      now: new Date("2026-11-02T07:00:00.000Z"),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const ranking = first.data;
    expect(ranking.candidates[0].id).toBe(technicianId);
    expect(
      ranking.candidates.find((row) => row.id === absentTechnicianId)
        ?.excludedReason,
    ).toBe("absence");

    const second = await scoreCandidates(office, visitId, {
      now: new Date("2026-11-02T07:00:00.000Z"),
    });
    expect(second).toEqual(first);
  });

  it("tørrkjøring skriver ingenting, anvendelse revisjonslogger poengsummen", async () => {
    const beforeAudit = await prisma.auditLog.count({
      where: { entityType: "Visit", entityId: visitId },
    });
    const beforeAssignments = await prisma.visitTechnician.count({
      where: { visitId },
    });

    const dry = await autoAssign(office, [visitId], { dryRun: true });
    expect(dry.ok).toBe(true);
    if (dry.ok) {
      expect(dry.data.assignments).toHaveLength(1);
      expect(dry.data.assignments[0].technicianId).toBe(technicianId);
    }
    expect(
      await prisma.visitTechnician.count({ where: { visitId } }),
    ).toBe(beforeAssignments);
    expect(
      await prisma.auditLog.count({
        where: { entityType: "Visit", entityId: visitId },
      }),
    ).toBe(beforeAudit);

    const applied = await autoAssign(office, [visitId], { dryRun: false });
    expect(applied.ok).toBe(true);
    expect(
      await prisma.visitTechnician.count({ where: { visitId } }),
    ).toBe(1);

    const log = await prisma.auditLog.findFirst({
      where: { entityType: "Visit", entityId: visitId },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.metadata).toMatchObject({
      dispatch: { technicianId, score: expect.any(Number) },
    });
  });

  it("avviser anvendelse uten workorders.assign", async () => {
    const raw = await prisma.user.findFirst({
      where: { id: technicianId },
      select: { id: true, name: true, email: true },
    });
    const denied = await autoAssign(
      actor({
        id: raw!.id,
        name: raw!.name,
        email: raw!.email,
        role: "TECHNICIAN",
        departmentId,
        roleDefinition: { permissions: ["workorders.view"] },
      }),
      [visitId],
      { dryRun: false },
    );
    expect(denied.ok).toBe(false);
  });

  it("aggregerer kapasitet og belastning", async () => {
    const date = parseDateOnly("2026-11-02")!;
    await prisma.capacityPlan.create({
      data: {
        departmentId,
        date,
        capacityMinutes: 400,
      },
    });

    const result = await getCapacityOverview(
      office,
      parseDateOnly("2026-11-02")!,
      parseDateOnly("2026-11-02")!,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const day = result.data.days.find((row) => row.date === "2026-11-02");
    expect(day?.capacityMinutes).toBe(400);
    expect(day?.loadMinutes).toBeGreaterThanOrEqual(120);

    await expect(
      prisma.capacityPlan.create({
        data: { departmentId, date, capacityMinutes: 300 },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("krever dispatch.configure for territorier", async () => {
    const denied = await saveTerritory(
      actor({
        departmentId,
        roleDefinition: { permissions: ["workorders.view"] },
      }),
      {
        departmentId,
        name: "Oslo",
        postalPrefixes: "01",
      },
    );
    expect(denied.ok).toBe(false);
  });

  it("finner ledige tidsrom uten å skrive", async () => {
    const before = await prisma.visit.count({ where: { workOrderId } });
    const result = await findSlot(office, workOrderId, { days: 3 });
    expect(result.ok).toBe(true);
    expect(await prisma.visit.count({ where: { workOrderId } })).toBe(before);
  });

  it("teller unntak innenfor avdelingssperren", async () => {
    const result = await getDispatchExceptionCounts(office);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.unassignedToday).toBe(0);
    expect(result.data.visitsWithoutTechnician).toBeGreaterThanOrEqual(0);
  });
});
