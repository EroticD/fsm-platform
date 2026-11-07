import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import { cancelUncontractedSlaClocks } from "@/server/sla-cleanup";
import { runSlaCleanupJob } from "@/server/sla-cleanup-job";

const describeIntegration = integrationEnabled ? describe : describe.skip;

const NOW = new Date("2026-06-15T10:00:00.000Z");

describeIntegration("Opprydding av SLA-klokker uten aktiv avtale", () => {
  let departmentId = "";
  let customerId = "";
  let contractedCustomerId = "";
  let activePolicyId = "";
  let otherPolicyId = "";
  let inactivePolicyId = "";

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-sla-cleanup-avd") },
    });
    departmentId = department.id;
    const customer = await prisma.customer.create({
      data: { name: unique("IT-sla-cleanup-kunde"), departmentId },
    });
    customerId = customer.id;
    const contractedCustomer = await prisma.customer.create({
      data: { name: unique("IT-sla-cleanup-avtale-kunde"), departmentId },
    });
    contractedCustomerId = contractedCustomer.id;

    const [active, other, inactive] = await Promise.all([
      prisma.slaPolicy.create({
        data: {
          name: unique("IT-sla-cleanup-aktiv"),
          departmentId,
          responseMinutes: 30,
          resolutionMinutes: 120,
          businessHoursOnly: false,
        },
      }),
      prisma.slaPolicy.create({
        data: {
          name: unique("IT-sla-cleanup-annen"),
          departmentId,
          responseMinutes: 60,
          resolutionMinutes: 240,
          businessHoursOnly: false,
        },
      }),
      prisma.slaPolicy.create({
        data: {
          name: unique("IT-sla-cleanup-inaktiv"),
          departmentId,
          isActive: false,
          responseMinutes: 30,
          resolutionMinutes: 120,
          businessHoursOnly: false,
        },
      }),
    ]);
    activePolicyId = active.id;
    otherPolicyId = other.id;
    inactivePolicyId = inactive.id;
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({ where: { departmentId } });
    await prisma.contract.deleteMany({ where: { departmentId } });
    await prisma.slaPolicy.deleteMany({ where: { departmentId } });
    await prisma.customer.deleteMany({ where: { departmentId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  async function createOrderWithClock(options: {
    policyId: string;
    contractId?: string | null;
    customerId?: string;
    state?: "ON_TRACK" | "BREACHED" | "MET" | "CANCELLED";
  }) {
    const workOrder = await prisma.workOrder.create({
      data: {
        reference: unique("REF-SLA-CLEANUP"),
        title: unique("IT-sla-cleanup-oppdrag"),
        departmentId,
        customerId: options.customerId ?? customerId,
        contractId: options.contractId ?? null,
        status: "OPEN",
        scheduledFor: new Date("2026-06-15T00:00:00.000Z"),
      },
      select: { id: true, title: true },
    });
    const clock = await prisma.slaClock.create({
      data: {
        workOrderId: workOrder.id,
        policyId: options.policyId,
        startedAt: NOW,
        respondBy: new Date(NOW.getTime() + 30 * 60_000),
        resolveBy: new Date(NOW.getTime() + 120 * 60_000),
        state: options.state ?? "ON_TRACK",
      },
      select: { id: true, state: true },
    });
    return { workOrder, clock };
  }

  async function createContract(options: {
    policyId?: string | null;
    status?: "ACTIVE" | "PAUSED" | "EXPIRED";
    startDate?: string;
    endDate?: string | null;
  }) {
    return prisma.contract.create({
      data: {
        title: unique("IT-sla-cleanup-avtale"),
        intervalMonths: 12,
        startDate: new Date(options.startDate ?? "2026-01-01T00:00:00.000Z"),
        endDate: options.endDate
          ? new Date(`${options.endDate}T00:00:00.000Z`)
          : null,
        nextServiceDate: new Date("2027-01-01T00:00:00.000Z"),
        customerId: contractedCustomerId,
        departmentId,
        slaPolicyId: options.policyId ?? null,
        status: options.status ?? "ACTIVE",
        isActive: (options.status ?? "ACTIVE") === "ACTIVE",
      },
      select: { id: true },
    });
  }

  it("kansellerer klokke når oppdraget mangler aktiv avtale", async () => {
    const { workOrder, clock } = await createOrderWithClock({
      policyId: activePolicyId,
    });

    const result = await cancelUncontractedSlaClocks(prisma, { now: NOW });

    expect(
      result.candidates.some((candidate) => candidate.clockId === clock.id),
    ).toBe(true);
    expect(result.candidates.find((c) => c.clockId === clock.id)?.reason).toBe(
      "no-active-contract",
    );
    const stored = await prisma.slaClock.findUnique({
      where: { id: clock.id },
      select: { state: true, breachedAt: true },
    });
    expect(stored).toEqual({ state: "CANCELLED", breachedAt: null });
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "SlaClock",
          entityId: clock.id,
          action: "SLA: klokken kansellert ved opprydding",
        },
      }),
    ).toBe(1);
    expect(workOrder.id).toBeTruthy();
  });

  it("kansellerer klokke ved inaktiv avtale eller inaktiv policy", async () => {
    const pausedContract = await createContract({
      policyId: activePolicyId,
      status: "PAUSED",
    });
    const paused = await createOrderWithClock({
      policyId: activePolicyId,
      contractId: pausedContract.id,
      customerId: contractedCustomerId,
    });

    const inactivePolicyContract = await createContract({
      policyId: inactivePolicyId,
    });
    const inactivePolicy = await createOrderWithClock({
      policyId: inactivePolicyId,
      contractId: inactivePolicyContract.id,
      customerId: contractedCustomerId,
    });

    const result = await cancelUncontractedSlaClocks(prisma, { now: NOW });

    const candidateIds = new Set(result.candidates.map((c) => c.clockId));
    expect(candidateIds.has(paused.clock.id)).toBe(true);
    expect(candidateIds.has(inactivePolicy.clock.id)).toBe(true);
    const states = await prisma.slaClock.findMany({
      where: { id: { in: [paused.clock.id, inactivePolicy.clock.id] } },
      select: { id: true, state: true },
    });
    expect(states.every((row) => row.state === "CANCELLED")).toBe(true);
  });

  it("beholder klokke når aktiv avtale og aktiv policy dekker den", async () => {
    const contract = await createContract({ policyId: activePolicyId });
    const { clock } = await createOrderWithClock({
      policyId: activePolicyId,
      contractId: contract.id,
      customerId: contractedCustomerId,
    });

    const result = await cancelUncontractedSlaClocks(prisma, { now: NOW });

    expect(
      result.candidates.some((candidate) => candidate.clockId === clock.id),
    ).toBe(false);
    const stored = await prisma.slaClock.findUnique({
      where: { id: clock.id },
      select: { state: true },
    });
    expect(stored?.state).toBe("ON_TRACK");
  });

  it("kansellerer klokke som peker på en annen policy enn avtalen gir", async () => {
    const contract = await createContract({ policyId: activePolicyId });
    const { clock } = await createOrderWithClock({
      policyId: otherPolicyId,
      contractId: contract.id,
      customerId: contractedCustomerId,
    });

    const result = await cancelUncontractedSlaClocks(prisma, { now: NOW });

    const candidate = result.candidates.find((c) => c.clockId === clock.id);
    expect(candidate?.reason).toBe("applicable-policy-differs");
    expect(candidate?.applicablePolicyId).toBe(activePolicyId);
    const stored = await prisma.slaClock.findUnique({
      where: { id: clock.id },
      select: { state: true },
    });
    expect(stored?.state).toBe("CANCELLED");
  });

  it("rører ikke klokker som allerede er kansellert", async () => {
    const { clock } = await createOrderWithClock({
      policyId: activePolicyId,
      state: "CANCELLED",
    });

    const result = await cancelUncontractedSlaClocks(prisma, { now: NOW });

    expect(
      result.candidates.some((candidate) => candidate.clockId === clock.id),
    ).toBe(false);
    const stored = await prisma.slaClock.findUnique({
      where: { id: clock.id },
      select: { state: true },
    });
    expect(stored?.state).toBe("CANCELLED");
  });

  it("tørrkjøring rapporterer kandidater uten å skrive", async () => {
    const { clock } = await createOrderWithClock({
      policyId: activePolicyId,
    });

    const result = await cancelUncontractedSlaClocks(prisma, {
      now: NOW,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(
      result.candidates.some((candidate) => candidate.clockId === clock.id),
    ).toBe(true);
    const stored = await prisma.slaClock.findUnique({
      where: { id: clock.id },
      select: { state: true },
    });
    expect(stored?.state).toBe("ON_TRACK");
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "SlaClock",
          entityId: clock.id,
          action: "SLA: klokken kansellert ved opprydding",
        },
      }),
    ).toBe(0);
  });

  it("kansellerer også avsluttet MET-klokke uten avtaledekning", async () => {
    const { clock } = await createOrderWithClock({
      policyId: activePolicyId,
      state: "MET",
    });

    const result = await cancelUncontractedSlaClocks(prisma, { now: NOW });

    expect(
      result.candidates.some((candidate) => candidate.clockId === clock.id),
    ).toBe(true);
    const stored = await prisma.slaClock.findUnique({
      where: { id: clock.id },
      select: { state: true },
    });
    expect(stored?.state).toBe("CANCELLED");
  });

  it("er idempotent og tåler samtidig kjøring", async () => {
    const { clock } = await createOrderWithClock({
      policyId: activePolicyId,
    });

    const [first, second] = await Promise.all([
      cancelUncontractedSlaClocks(prisma, { now: NOW }),
      cancelUncontractedSlaClocks(prisma, { now: NOW }),
    ]);

    // Advisory-låsen serialiserer kjøringene. Den andre ser allerede
    // kansellert klokke og skal ikke kansellere eller revidere den på nytt.
    expect(first.cancelled + second.cancelled).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          entityType: "SlaClock",
          entityId: clock.id,
          action: "SLA: klokken kansellert ved opprydding",
        },
      }),
    ).toBe(1);

    const again = await cancelUncontractedSlaClocks(prisma, { now: NOW });
    expect(
      again.candidates.some((candidate) => candidate.clockId === clock.id),
    ).toBe(false);
    expect(again.cancelled).toBe(0);
  });

  it("registrerer kjøring, kansellert antall og siste status for metrics", async () => {
    const { clock } = await createOrderWithClock({
      policyId: activePolicyId,
    });

    const result = await runSlaCleanupJob({
      now: NOW,
      env: { SLA_CLEANUP_ENABLED: "true", SLA_CLEANUP_INTERVAL_HOURS: "6" },
    });

    expect(result.error).toBeNull();
    expect(result.runId).toBeTruthy();
    const run = await prisma.slaCleanupRun.findUniqueOrThrow({
      where: { id: result.runId! },
      select: {
        status: true,
        cancelled: true,
        scanned: true,
        finishedAt: true,
      },
    });
    expect(run.status).toBe("SUCCEEDED");
    expect(run.finishedAt).not.toBeNull();
    expect(run.cancelled).toBeGreaterThanOrEqual(1);
    expect(run.scanned).toBeGreaterThanOrEqual(1);
    expect(
      result.result?.candidates.some(
        (candidate) => candidate.clockId === clock.id,
      ),
    ).toBe(true);

    await prisma.slaCleanupRun.deleteMany({ where: { id: result.runId! } });
  });
});
