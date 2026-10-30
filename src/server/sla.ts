// i18n-ignore-file: revisjonsloggen lagrer stabile, ferdig formaterte norske
// handlingsstrenger. De oversettes ved visning; tjenesten har ingen UI-tekst.
/**
 * SLA-klokker for oppdrag.
 *
 * Alle frister regnes ut gjennom `business-hours.ts`, aldri med direkte
 * dato-aritmetikk. Klokkene opprettes i samme transaksjon som oppdraget, og
 * respons/løsning skrives i samme transaksjon som visittstatusen.
 */

import type { Prisma, SlaState } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  addBusinessMinutes,
  type BusinessCalendar,
} from "@/lib/business-hours";
import {
  slaBreachedAt,
  slaNextDeadline,
  slaRemainingMinutes,
  slaStateAt,
} from "@/lib/sla";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { notifyWorkOrderEvent } from "@/server/notifications";
import {
  can,
  fail,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import { loadBusinessCalendar } from "./business-hours";

type Tx = Prisma.TransactionClient;

const SYSTEM_ACTOR = { id: "", name: "SLA", email: null };

export type SlaClockSummary = {
  id: string;
  policyId: string;
  policyName: string;
  startedAt: Date;
  respondBy: Date;
  resolveBy: Date;
  respondedAt: Date | null;
  resolvedAt: Date | null;
  state: SlaState;
  breachedAt: Date | null;
};

export type StartClockResult = {
  id: string;
  policyId: string;
  state: SlaState;
} | null;

function addMinutesAt(start: Date, minutes: number): Date {
  return new Date(start.getTime() + Math.max(0, minutes) * 60_000);
}

function deadlineFor(
  start: Date,
  minutes: number,
  businessHoursOnly: boolean,
  calendar: BusinessCalendar,
): Date {
  return businessHoursOnly
    ? addBusinessMinutes(start, minutes, calendar)
    : addMinutesAt(start, minutes);
}

/**
 * Finner policyen som gjelder for et oppdrag: avtalens policy først, deretter
 * en aktiv avtale for kunden, og til slutt avdelingens standardpolicy.
 */
export async function resolveSlaPolicyId(
  tx: Tx,
  workOrderId: string,
): Promise<{ policyId: string; calendarDepartmentId: string | null } | null> {
  const workOrder = await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      customerId: true,
      departmentId: true,
      contract: {
        select: {
          id: true,
          status: true,
          slaPolicyId: true,
        },
      },
    },
  });
  if (!workOrder) return null;

  const isUsable = async (policyId: string | null) => {
    if (!policyId) return null;
    const policy = await tx.slaPolicy.findFirst({
      where: { id: policyId, isActive: true },
      select: { id: true, departmentId: true },
    });
    return policy;
  };

  if (workOrder.contract?.status === "ACTIVE") {
    const policy = await isUsable(workOrder.contract.slaPolicyId);
    if (policy) {
      return {
        policyId: policy.id,
        calendarDepartmentId: policy.departmentId ?? workOrder.departmentId,
      };
    }
  }

  if (workOrder.customerId) {
    const today = new Date();
    const contract = await tx.contract.findFirst({
      where: {
        customerId: workOrder.customerId,
        status: "ACTIVE",
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
        slaPolicyId: { not: null },
      },
      orderBy: { startDate: "desc" },
      select: { slaPolicyId: true },
    });
    const policy = await isUsable(contract?.slaPolicyId ?? null);
    if (policy) {
      return {
        policyId: policy.id,
        calendarDepartmentId: policy.departmentId ?? workOrder.departmentId,
      };
    }
  }

  // Avdelingens egen policy går foran en global standardpolicy.
  const departmentPolicy =
    (await tx.slaPolicy.findFirst({
      where: { isActive: true, departmentId: workOrder.departmentId },
      orderBy: { createdAt: "asc" },
      select: { id: true, departmentId: true },
    })) ??
    (await tx.slaPolicy.findFirst({
      where: { isActive: true, departmentId: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, departmentId: true },
    }));
  if (!departmentPolicy) return null;

  return {
    policyId: departmentPolicy.id,
    calendarDepartmentId:
      departmentPolicy.departmentId ?? workOrder.departmentId,
  };
}

/**
 * Oppretter én klokke for oppdraget. Kalles i oppdrettstransaksjonen, slik at
 * et oppdrag aldri kan finnes uten klokken sin. Returnerer null når ingen
 * aktiv policy gjelder.
 */
export async function startClock(
  tx: Tx,
  workOrderId: string,
  options: { policyId?: string | null; now?: Date } = {},
): Promise<StartClockResult> {
  const now = options.now ?? new Date();

  let policyId = options.policyId ?? null;
  let calendarDepartmentId: string | null = null;
  if (policyId) {
    const policy = await tx.slaPolicy.findFirst({
      where: { id: policyId, isActive: true },
      select: { id: true, departmentId: true },
    });
    if (!policy) return null;
    calendarDepartmentId = policy.departmentId;
  } else {
    const resolved = await resolveSlaPolicyId(tx, workOrderId);
    if (!resolved) return null;
    policyId = resolved.policyId;
    calendarDepartmentId = resolved.calendarDepartmentId;
  }

  const existing = await tx.slaClock.findUnique({
    where: { workOrderId_policyId: { workOrderId, policyId } },
    select: { id: true, policyId: true, state: true },
  });
  if (existing) return existing;

  const policy = await tx.slaPolicy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      responseMinutes: true,
      resolutionMinutes: true,
      businessHoursOnly: true,
      departmentId: true,
    },
  });
  if (!policy) return null;

  const calendar = await loadBusinessCalendar(
    tx,
    calendarDepartmentId ?? policy.departmentId,
  );
  const respondBy = deadlineFor(
    now,
    policy.responseMinutes,
    policy.businessHoursOnly,
    calendar,
  );
  const resolveBy = deadlineFor(
    now,
    policy.resolutionMinutes,
    policy.businessHoursOnly,
    calendar,
  );

  const clock = await tx.slaClock.create({
    data: {
      workOrderId,
      policyId: policy.id,
      startedAt: now,
      respondBy,
      resolveBy,
      state: "ON_TRACK",
    },
    select: { id: true, policyId: true, state: true },
  });

  await audit(tx, {
    entityType: "SlaClock",
    entityId: clock.id,
    action: "SLA: klokken startet",
    actor: SYSTEM_ACTOR,
    metadata: {
      workOrderId,
      policyId: policy.id,
      respondBy: respondBy.toISOString(),
      resolveBy: resolveBy.toISOString(),
    },
  });

  return clock;
}

function stateFor(
  clock: {
    startedAt: Date;
    respondBy: Date;
    resolveBy: Date;
    respondedAt: Date | null;
    resolvedAt: Date | null;
  },
  now: Date,
): { state: SlaState; breachedAt: Date | null } {
  const state = slaStateAt(clock, now) as SlaState;
  return {
    state,
    breachedAt:
      state === "BREACHED" ? (slaBreachedAt(clock, now) ?? now) : null,
  };
}

/**
 * Første respons. Kalles på overgangen til EN_ROUTE (eller ON_SITE dersom
 * visitten hopper over EN_ROUTE). Bare første gang skrives.
 */
export async function markResponded(
  tx: Tx,
  workOrderId: string,
  at = new Date(),
): Promise<void> {
  const clocks = await tx.slaClock.findMany({
    where: {
      workOrderId,
      respondedAt: null,
      resolvedAt: null,
      state: { not: "CANCELLED" },
    },
    select: {
      id: true,
      startedAt: true,
      respondBy: true,
      resolveBy: true,
      respondedAt: true,
      resolvedAt: true,
    },
    take: 20,
  });

  for (const clock of clocks) {
    const next = stateFor({ ...clock, respondedAt: at }, at);
    await tx.slaClock.update({
      where: { id: clock.id },
      data: {
        respondedAt: at,
        state: next.state,
        breachedAt: next.breachedAt,
      },
    });
    await audit(tx, {
      entityType: "SlaClock",
      entityId: clock.id,
      action: "SLA: første respons registrert",
      actor: SYSTEM_ACTOR,
      metadata: {
        workOrderId,
        respondedAt: at.toISOString(),
        state: next.state,
      },
    });
  }
}

/** Løsning første gang visitten fullføres. */
export async function markResolved(
  tx: Tx,
  workOrderId: string,
  at = new Date(),
): Promise<void> {
  const clocks = await tx.slaClock.findMany({
    where: {
      workOrderId,
      resolvedAt: null,
      state: { not: "CANCELLED" },
    },
    select: {
      id: true,
      startedAt: true,
      respondBy: true,
      resolveBy: true,
      respondedAt: true,
      resolvedAt: true,
    },
    take: 20,
  });

  for (const clock of clocks) {
    const next = stateFor({ ...clock, resolvedAt: at }, at);
    await tx.slaClock.update({
      where: { id: clock.id },
      data: {
        resolvedAt: at,
        state: next.state,
        breachedAt: next.breachedAt,
      },
    });
    await audit(tx, {
      entityType: "SlaClock",
      entityId: clock.id,
      action: "SLA: løsning registrert",
      actor: SYSTEM_ACTOR,
      metadata: {
        workOrderId,
        resolvedAt: at.toISOString(),
        state: next.state,
      },
    });
  }
}

/** Et kansellert oppdrag skal ikke lenger telle som brutt eller i fare. */
export async function cancelClocks(
  tx: Tx,
  workOrderId: string,
  at = new Date(),
): Promise<void> {
  await tx.slaClock.updateMany({
    where: {
      workOrderId,
      state: { notIn: ["MET", "CANCELLED"] },
    },
    data: { state: "CANCELLED", breachedAt: null },
  });
  await audit(tx, {
    entityType: "SlaClock",
    entityId: workOrderId,
    action: "SLA: klokken kansellert",
    actor: SYSTEM_ACTOR,
    metadata: { workOrderId, cancelledAt: at.toISOString() },
  });
}

/**
 * Regner fristene på nytt med dagens åpningstider og policy, og oppdaterer
 * tilstanden. Idempotent; brukes av sveipingen og kan trygt kjøres flere
 * ganger. Avsluttede klokker beholder tidspunktene sine.
 */
export async function recomputeClock(
  clockId: string,
  now = new Date(),
): Promise<{ state: SlaState; previous: SlaState } | null> {
  const clock = await prisma.slaClock.findUnique({
    where: { id: clockId },
    include: {
      policy: {
        select: {
          responseMinutes: true,
          resolutionMinutes: true,
          businessHoursOnly: true,
          departmentId: true,
        },
      },
      workOrder: { select: { departmentId: true } },
    },
  });
  if (!clock || clock.state === "CANCELLED") return null;

  const calendar = await loadBusinessCalendar(
    prisma as unknown as Tx,
    clock.policy.departmentId ?? clock.workOrder.departmentId,
  );

  const respondBy = clock.resolvedAt
    ? clock.respondBy
    : deadlineFor(
        clock.startedAt,
        clock.policy.responseMinutes,
        clock.policy.businessHoursOnly,
        calendar,
      );
  const resolveBy = clock.resolvedAt
    ? clock.resolveBy
    : deadlineFor(
        clock.startedAt,
        clock.policy.resolutionMinutes,
        clock.policy.businessHoursOnly,
        calendar,
      );

  const next = stateFor(
    {
      startedAt: clock.startedAt,
      respondBy,
      resolveBy,
      respondedAt: clock.respondedAt,
      resolvedAt: clock.resolvedAt,
    },
    now,
  );

  await prisma.slaClock.update({
    where: { id: clock.id },
    data: {
      respondBy,
      resolveBy,
      state: next.state,
      breachedAt:
        next.state === "BREACHED"
          ? (next.breachedAt ?? clock.breachedAt)
          : null,
    },
  });

  return { state: next.state, previous: clock.state };
}

export type SlaSweepResult = {
  checked: number;
  atRisk: number;
  breached: number;
  met: number;
  notified: number;
};

/**
 * Sveiper aktive klokker. Bare overgangen til AT_RISK/BREACHED varsler, og
 * oppdateringen er betinget på forrige tilstand. To samtidige sveip gir derfor
 * nøyaktig én varselrad per klokke og tilstand.
 */
export async function sweepSlaClocks(now = new Date()): Promise<SlaSweepResult> {
  const clocks = await prisma.slaClock.findMany({
    where: { state: { notIn: ["MET", "CANCELLED"] } },
    orderBy: { resolveBy: "asc" },
    take: 500,
    include: {
      policy: {
        select: {
          name: true,
          responseMinutes: true,
          resolutionMinutes: true,
          businessHoursOnly: true,
          departmentId: true,
        },
      },
      workOrder: {
        select: {
          id: true,
          title: true,
          departmentId: true,
        },
      },
    },
  });

  const result: SlaSweepResult = {
    checked: 0,
    atRisk: 0,
    breached: 0,
    met: 0,
    notified: 0,
  };

  for (const clock of clocks) {
    result.checked += 1;
    const calendar = await loadBusinessCalendar(
      prisma as unknown as Tx,
      clock.policy.departmentId ?? clock.workOrder.departmentId,
    );
    const respondBy = clock.resolvedAt
      ? clock.respondBy
      : deadlineFor(
          clock.startedAt,
          clock.policy.responseMinutes,
          clock.policy.businessHoursOnly,
          calendar,
        );
    const resolveBy = clock.resolvedAt
      ? clock.resolveBy
      : deadlineFor(
          clock.startedAt,
          clock.policy.resolutionMinutes,
          clock.policy.businessHoursOnly,
          calendar,
        );
    const next = stateFor(
      {
        startedAt: clock.startedAt,
        respondBy,
        resolveBy,
        respondedAt: clock.respondedAt,
        resolvedAt: clock.resolvedAt,
      },
      now,
    );

    const claimed = await prisma.slaClock.updateMany({
      where: { id: clock.id, state: clock.state },
      data: {
        respondBy,
        resolveBy,
        state: next.state,
        breachedAt:
          next.state === "BREACHED"
            ? (next.breachedAt ?? clock.breachedAt)
            : null,
      },
    });
    if (claimed.count !== 1) continue;

    if (next.state === "AT_RISK") result.atRisk += 1;
    if (next.state === "BREACHED") result.breached += 1;
    if (next.state === "MET") result.met += 1;

    if (
      next.state !== clock.state &&
      (next.state === "AT_RISK" || next.state === "BREACHED")
    ) {
      const deadline = slaNextDeadline({
        respondBy,
        resolveBy,
        respondedAt: clock.respondedAt,
      });
      const remaining = slaRemainingMinutes(
        {
          startedAt: clock.startedAt,
          respondBy,
          resolveBy,
          respondedAt: clock.respondedAt,
          resolvedAt: clock.resolvedAt,
        },
        now,
      );
      const title =
        next.state === "BREACHED"
          ? "SLA-fristen er brutt"
          : "SLA-fristen nærmer seg";
      const body =
        next.state === "BREACHED"
          ? `Oppdraget «${clock.workOrder.title}» har brutt ${deadline.kind === "response" ? "svartiden" : "løsningstiden"} (${clock.policy.name}).`
          : `Oppdraget «${clock.workOrder.title}» har ${Math.max(0, remaining)} minutter igjen til ${deadline.kind === "response" ? "svartiden" : "løsningstiden"} (${clock.policy.name}).`;

      result.notified += await notifyWorkOrderEvent(
        clock.workOrder.id,
        next.state === "BREACHED" ? "SLA_BREACHED" : "SLA_AT_RISK",
        title,
        body,
        `/oppdrag/${clock.workOrder.id}`,
        `sla:${next.state.toLowerCase()}:${clock.id}`,
      );
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Innstillinger: SLA-policyer
// ---------------------------------------------------------------------------

/** Alt SLA-fanen i innstillingene trenger for én valgt avdeling. */
export async function getSlaSettingsView(
  actor: ServiceActor,
  requestedDepartmentId?: string | null,
) {
  if (!can(actor, "sla.manage")) return fail("forbidden");

  const departments = await prisma.department.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    take: 100,
    select: { id: true, name: true, isDefault: true },
  });
  const departmentId =
    (requestedDepartmentId &&
      departments.some((department) => department.id === requestedDepartmentId)
      ? requestedDepartmentId
      : departments.find((department) => department.isDefault)?.id) ??
    departments[0]?.id ??
    null;

  const [policies, hours, holidays] = await Promise.all([
    prisma.slaPolicy.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      take: 200,
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { contracts: true, clocks: true } },
      },
    }),
    departmentId
      ? prisma.businessHours.findMany({
          where: { departmentId },
          orderBy: { weekday: "asc" },
          take: 7,
        })
      : Promise.resolve([]),
    prisma.holiday.findMany({
      orderBy: { date: "asc" },
      take: 500,
      include: { department: { select: { id: true, name: true } } },
    }),
  ]);

  return ok({
    departments,
    departmentId,
    policies,
    hours,
    holidays,
  });
}

export async function listSlaPolicies(actor: ServiceActor) {
  if (!can(actor, "sla.manage")) return fail("forbidden");

  const policies = await prisma.slaPolicy.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    take: 200,
    include: {
      department: { select: { id: true, name: true } },
      _count: { select: { contracts: true, clocks: true } },
    },
  });
  return ok({ policies });
}

/** Aktive policyer til avtaleskjemaet. Krever bare avtalesyn. */
export async function listSlaPoliciesForContracts(actor: ServiceActor) {
  if (!can(actor, "contracts.view") && !can(actor, "contracts.manage")) {
    return fail("forbidden");
  }

  const policies = await prisma.slaPolicy.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, name: true, departmentId: true },
  });
  return ok({ policies });
}

export type SlaPolicyInput = {
  id?: unknown;
  name?: unknown;
  departmentId?: unknown;
  responseMinutes?: unknown;
  resolutionMinutes?: unknown;
  businessHoursOnly?: unknown;
  isActive?: unknown;
};

function positiveMinutes(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > 60 * 24 * 30) {
    return null;
  }
  return number;
}

export async function saveSlaPolicy(
  actor: ServiceActor,
  input: SlaPolicyInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "sla.manage")) return fail("forbidden");

  const id = cleanText(input.id, { maxLength: LIMITS.line }) || null;
  const name = cleanText(input.name, { maxLength: LIMITS.title });
  const departmentId =
    cleanText(input.departmentId, { maxLength: LIMITS.line }) || null;
  const responseMinutes = positiveMinutes(input.responseMinutes);
  const resolutionMinutes = positiveMinutes(input.resolutionMinutes);
  if (!name || responseMinutes === null || resolutionMinutes === null) {
    return fail("invalid");
  }

  if (departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: departmentId, isActive: true },
      select: { id: true },
    });
    if (!department) return fail("invalid");
  }

  const businessHoursOnly =
    input.businessHoursOnly === undefined
      ? true
      : input.businessHoursOnly === true ||
        input.businessHoursOnly === "true" ||
        input.businessHoursOnly === "on";
  const isActive =
    input.isActive === undefined
      ? true
      : input.isActive === true ||
        input.isActive === "true" ||
        input.isActive === "on";

  const policy = await prisma.$transaction(async (tx) => {
    const saved = id
      ? await tx.slaPolicy.update({
          where: { id },
          data: {
            name,
            departmentId,
            responseMinutes,
            resolutionMinutes,
            businessHoursOnly,
            isActive,
          },
        })
      : await tx.slaPolicy.create({
          data: {
            name,
            departmentId,
            responseMinutes,
            resolutionMinutes,
            businessHoursOnly,
            isActive,
          },
        });

    await audit(tx, {
      entityType: "SlaPolicy",
      entityId: saved.id,
      action: `${id ? "Oppdaterte" : "Opprettet"} SLA-policy: ${name}`,
      actor: toAuditActor(actor),
      metadata: { departmentId, responseMinutes, resolutionMinutes },
    });
    return saved;
  });

  return ok({ id: policy.id });
}

/** Deaktiverer en policy. Klokker og avtaler beholder referansen. */
export async function deactivateSlaPolicy(
  actor: ServiceActor,
  policyId: string,
): Promise<ServiceResult> {
  if (!can(actor, "sla.manage")) return fail("forbidden");

  const policy = await prisma.slaPolicy.findUnique({
    where: { id: policyId },
    select: { id: true, name: true },
  });
  if (!policy) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.slaPolicy.update({
      where: { id: policyId },
      data: { isActive: false },
    });
    await audit(tx, {
      entityType: "SlaPolicy",
      entityId: policyId,
      action: `Deaktiverte SLA-policy: ${policy.name}`,
      actor: toAuditActor(actor),
    });
  });
  return ok(undefined);
}
