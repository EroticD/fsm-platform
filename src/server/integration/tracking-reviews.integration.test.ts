import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";
import {
  cleanupVisitLocationPings,
  createTrackingLink,
  getPublicTracking,
  hashTrackingToken,
  LOCATION_PING_RETENTION_MS,
  recordLocationPing,
} from "@/server/tracking";
import {
  getPublicReview,
  hashReviewToken,
  requestReview,
  submitReview,
} from "@/server/reviews";
import { setVisitStatus } from "@/server/visits";

const describeIntegration = integrationEnabled ? describe : describe.skip;

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "actor",
    name: "IT Aktør",
    email: "it@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: null,
    permissionsCustomized: true,
    permissions: ["workorders.view", "workorders.edit", "workorders.update"],
    roleDefinition: null,
    ...overrides,
  };
}

describeIntegration("Live sporing og omtaler", () => {
  let departmentId = "";
  let departmentOffId = "";
  let customerId = "";
  let office: ServiceActor;
  let technician: ServiceActor;
  let otherTechnicianId = "";
  let workOrderId = "";
  let visitId = "";
  let offWorkOrderId = "";
  let offVisitId = "";

  beforeAll(async () => {
    const [department, departmentOff] = await Promise.all([
      prisma.department.create({
        data: { name: unique("IT-sporing-avd"), trackingEnabled: true },
      }),
      prisma.department.create({
        data: { name: unique("IT-sporing-avd-av") },
      }),
    ]);
    departmentId = department.id;
    departmentOffId = departmentOff.id;

    const customer = await prisma.customer.create({
      data: { name: unique("IT-sporing-kunde"), departmentId },
    });
    customerId = customer.id;

    const [officeUser, techUser, otherTech] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Ola Kontor",
          email: `${unique("sporing-kontor")}@example.test`,
          role: "OFFICE",
          isActive: true,
          departmentId,
          permissions: ["workorders.view", "workorders.edit", "workorders.update"],
          permissionsCustomized: true,
        },
      }),
      prisma.user.create({
        data: {
          name: "Kari Integrasjon",
          email: `${unique("sporing-tech")}@example.test`,
          role: "TECHNICIAN",
          isActive: true,
          departmentId,
          permissions: ["workorders.view", "workorders.update"],
          permissionsCustomized: true,
        },
      }),
      prisma.user.create({
        data: {
          name: "Per Annen",
          email: `${unique("sporing-tech-2")}@example.test`,
          role: "TECHNICIAN",
          isActive: true,
          departmentId,
          permissions: ["workorders.view", "workorders.update"],
          permissionsCustomized: true,
        },
      }),
    ]);
    otherTechnicianId = otherTech.id;

    office = actor({
      id: officeUser.id,
      name: officeUser.name,
      email: officeUser.email,
      departmentId,
    });
    technician = actor({
      id: techUser.id,
      name: techUser.name,
      email: techUser.email,
      departmentId,
      role: "TECHNICIAN",
    });

    const now = Date.now();
    const order = await prisma.workOrder.create({
      data: {
        title: unique("IT-sporing-oppdrag"),
        departmentId,
        customerId,
        status: "OPEN",
        latitude: 60.3913,
        longitude: 5.3221,
        technicians: { connect: { id: techUser.id } },
      },
    });
    workOrderId = order.id;

    const visit = await prisma.visit.create({
      data: {
        workOrderId,
        startsAt: new Date(now - 30 * 60_000),
        endsAt: new Date(now + 30 * 60_000),
        status: "PLANNED",
        technicians: { create: { userId: techUser.id } },
      },
    });
    visitId = visit.id;

    const offOrder = await prisma.workOrder.create({
      data: {
        title: unique("IT-sporing-av-oppdrag"),
        departmentId: departmentOffId,
        status: "OPEN",
        technicians: { connect: { id: techUser.id } },
      },
    });
    offWorkOrderId = offOrder.id;
    const offVisit = await prisma.visit.create({
      data: {
        workOrderId: offWorkOrderId,
        startsAt: new Date(now - 30 * 60_000),
        endsAt: new Date(now + 30 * 60_000),
        status: "PLANNED",
        technicians: { create: { userId: techUser.id } },
      },
    });
    offVisitId = offVisit.id;
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({
      where: { id: { in: [workOrderId, offWorkOrderId].filter(Boolean) } },
    });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({
      where: { email: { contains: "sporing-" } },
    });
    await prisma.department.deleteMany({
      where: { id: { in: [departmentId, departmentOffId].filter(Boolean) } },
    });
  });

  it("krever at avdelingen har slått på sporing", async () => {
    const admin = actor({
      id: office.id,
      name: office.name,
      email: office.email,
      role: "ADMIN",
      departmentId: null,
    });
    const result = await createTrackingLink(admin, offVisitId);

    expect(result).toMatchObject({
      ok: false,
      reason: "forbidden",
      details: { code: "tracking.errors.disabled" },
    });
  });

  it("oppretter hash-only lenke, mottar ping og viser ETA uten koordinater", async () => {
    const created = await createTrackingLink(office, visitId);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const row = await prisma.trackingLink.findUnique({
      where: { tokenHash: hashTrackingToken(created.data.token) },
      select: { tokenHash: true, expiresAt: true, visit: { select: { endsAt: true } } },
    });
    expect(row).not.toBeNull();
    expect(row!.expiresAt.getTime()).toBe(
      row!.visit.endsAt.getTime() + 2 * 60 * 60_000,
    );

    await expect(
      setVisitStatus(office, visitId, "EN_ROUTE"),
    ).resolves.toMatchObject({ ok: true });

    const ping = await recordLocationPing(technician, {
      visitId,
      latitude: 59.9139,
      longitude: 10.7522,
    });
    expect(ping.ok).toBe(true);

    const publicView = await getPublicTracking(created.data.token);
    expect(publicView.ok).toBe(true);
    if (!publicView.ok) return;
    expect(publicView.data.technicianFirstName).toBe("Kari");
    expect(publicView.data.etaMinutes).toBeGreaterThan(0);
    expect(publicView.data.lastUpdatedAt).not.toBeNull();
    expect(JSON.stringify(publicView.data)).not.toContain("latitude");
    expect(JSON.stringify(publicView.data)).not.toContain("59.9139");
  });

  it("avviser ping fra montør som ikke er tildelt visitten", async () => {
    const result = await recordLocationPing(
      actor({
        id: otherTechnicianId,
        role: "TECHNICIAN",
        departmentId,
      }),
      { visitId, latitude: 59.9, longitude: 10.7 },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("stenger sporingen når visitten fullføres og bevarer statustidspunkt", async () => {
    const created = await createTrackingLink(office, visitId);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await expect(setVisitStatus(office, visitId, "ON_SITE")).resolves.toMatchObject({
      ok: true,
    });
    await expect(setVisitStatus(office, visitId, "DONE")).resolves.toMatchObject({
      ok: true,
    });

    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      select: { enRouteAt: true, onSiteAt: true, doneAt: true },
    });
    expect(visit?.enRouteAt).toBeInstanceOf(Date);
    expect(visit?.onSiteAt).toBeInstanceOf(Date);
    expect(visit?.doneAt).toBeInstanceOf(Date);

    const link = await prisma.trackingLink.findUnique({
      where: { tokenHash: hashTrackingToken(created.data.token) },
      select: { revokedAt: true },
    });
    expect(link?.revokedAt).toBeInstanceOf(Date);

    await expect(getPublicTracking(created.data.token)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    await expect(
      prisma.visitLocationPing.count({ where: { visitId } }),
    ).resolves.toBe(0);
  });

  it("ber om omtale idempotent og tillater bare én innsending", async () => {
    const first = await requestReview(office, visitId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.created).toBe(true);
    expect(first.data.token).toBeTruthy();

    const second = await requestReview(office, visitId);
    expect(second).toMatchObject({
      ok: true,
      data: { created: false, token: null, reviewId: first.data.reviewId },
    });

    const token = first.data.token!;
    await expect(
      submitReview(token, { score: 5, comment: "Rask og hyggelig." }),
    ).resolves.toMatchObject({ ok: true });
    await expect(submitReview(token, { score: 1 })).resolves.toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "reviews.errors.alreadySubmitted" },
    });

    const review = await prisma.review.findUnique({
      where: { tokenHash: hashReviewToken(token) },
      select: { score: true, submittedAt: true, tokenHash: true },
    });
    expect(review).toMatchObject({ score: 5 });
    expect(review?.submittedAt).toBeInstanceOf(Date);
    expect(review?.tokenHash).not.toBe(token);

    const publicReview = await getPublicReview(token);
    expect(publicReview).toMatchObject({
      ok: true,
      data: { submitted: true, score: 5 },
    });
  });

  it("sletter posisjonsping eldre enn 24 timer", async () => {
    const old = await prisma.visitLocationPing.create({
      data: {
        visitId: offVisitId,
        userId: office.id,
        latitude: 59.9,
        longitude: 10.7,
        recordedAt: new Date(
          Date.now() - LOCATION_PING_RETENTION_MS - 60_000,
        ),
      },
    });

    const deleted = await cleanupVisitLocationPings();
    expect(deleted).toBeGreaterThanOrEqual(1);
    await expect(
      prisma.visitLocationPing.findUnique({ where: { id: old.id } }),
    ).resolves.toBeNull();
  });
});
