// i18n-ignore-file: revisjonsloggen lagrer stabile handlingsstrenger på samme
// måte som de øvrige tjenestene; de oversettes ved visning.
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { formatDateLocalized } from "@/lib/dates";
import { logger } from "@/lib/logger";
import { cleanText, LIMITS } from "@/lib/sanitize";
import { sendNotificationEmail } from "@/lib/email";
import {
  deferForQuietHours,
  isWithinQuietHours,
} from "@/lib/reminders/quiet-hours";
import { reminderEmailContent } from "@/lib/reminders/messages";
import { messageThreadKey } from "./messaging";
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";
import {
  enqueueSms,
  hasSmsConsent,
  renderEventSms,
  type SmsDb,
} from "./sms";
import { isSmsEventKey, smsLocale, type SmsEventKey } from "@/lib/sms/templates";

export const REMINDER_CHANNELS = ["SMS", "EMAIL", "BOTH"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

/** Hvor ofte sveipet ser etter nye visiter som skal få påminnelse. */
export const REMINDER_SWEEP_INTERVAL_MS = 5 * 60_000;

/** Hvor langt fremover sveipet planlegger når regelen treffer nå. */
const SCHEDULE_LOOKAHEAD_MS = 10 * 60_000;

/** Etter tre forsøk gir vi opp en påminnelse. */
export const REMINDER_MAX_ATTEMPTS = 3;
const REMINDER_RETRY_BASE_MS = 5 * 60_000;
const PROCESSING_LEASE_MS = 15 * 60_000;

type ReminderRuleRow = {
  id: string;
  departmentId: string;
  channel: string;
  offsetHours: number;
  templateKey: string;
  quietStartHour: number | null;
  quietEndHour: number | null;
  timezone: string;
  maxPerVisit: number;
  isActive: boolean;
};

export type ReminderRuleInput = {
  id?: unknown;
  departmentId?: unknown;
  channel?: unknown;
  offsetHours?: unknown;
  templateKey?: unknown;
  quietStartHour?: unknown;
  quietEndHour?: unknown;
  timezone?: unknown;
  maxPerVisit?: unknown;
  isActive?: unknown;
};

function validHour(value: unknown): number | null | undefined {
  if (value === null || value === "" || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 23) {
    return undefined;
  }
  return number;
}

function validTimezone(value: unknown): string | null {
  const timezone = cleanText(value, { maxLength: 100 }) || "Europe/Oslo";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format();
    return timezone;
  } catch {
    return null;
  }
}

function isReminderChannel(value: unknown): value is ReminderChannel {
  return (
    typeof value === "string" &&
    (REMINDER_CHANNELS as readonly string[]).includes(value)
  );
}

function ruleScopeFor(actor: ServiceActor): Prisma.ReminderRuleWhereInput {
  if (!actor?.isActive) return { id: { in: [] } };
  if (isAdminActor(actor)) return {};
  return actor.departmentId
    ? { departmentId: actor.departmentId }
    : { id: { in: [] } };
}

function dispatchScopeFor(actor: ServiceActor): Prisma.ReminderDispatchWhereInput {
  if (!actor?.isActive) return { id: { in: [] } };
  if (isAdminActor(actor)) return {};
  return actor.departmentId
    ? { departmentId: actor.departmentId }
    : { id: { in: [] } };
}

/** Leser regler og siste utsendelser for innstillingssiden. */
export async function getReminderSettingsView(
  actor: ServiceActor,
  departmentId?: string | null,
) {
  if (!actor?.isActive || !can(actor, "settings.manage")) {
    return fail("forbidden");
  }

  const scopedDepartment = cleanText(departmentId, { maxLength: LIMITS.line });
  const [departments, rules, dispatches] = await Promise.all([
    prisma.department.findMany({
      where: {
        isActive: true,
        ...(isAdminActor(actor)
          ? {}
          : { id: actor.departmentId ?? "__none__" }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.reminderRule.findMany({
      where: {
        AND: [
          ruleScopeFor(actor),
          ...(scopedDepartment ? [{ departmentId: scopedDepartment }] : []),
        ],
      },
      orderBy: [{ departmentId: "asc" }, { offsetHours: "desc" }],
      include: { department: { select: { id: true, name: true } } },
      take: 200,
    }),
    prisma.reminderDispatch.findMany({
      where: {
        AND: [
          dispatchScopeFor(actor),
          ...(scopedDepartment ? [{ departmentId: scopedDepartment }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        channel: true,
        offsetHours: true,
        status: true,
        scheduledFor: true,
        sentAt: true,
        skipReason: true,
        lastError: true,
        attempts: true,
        locale: true,
        createdAt: true,
        visit: {
          select: {
            startsAt: true,
            workOrder: { select: { id: true, title: true } },
          },
        },
        department: { select: { name: true } },
      },
    }),
  ]);

  return ok({ departments, rules, dispatches });
}

async function departmentAllowed(
  actor: ServiceActor,
  departmentId: string,
): Promise<boolean> {
  if (isAdminActor(actor)) return true;
  return Boolean(actor.departmentId && actor.departmentId === departmentId);
}

export async function saveReminderRule(
  actor: ServiceActor,
  input: ReminderRuleInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!actor?.isActive || !can(actor, "settings.manage")) {
    return fail("forbidden");
  }

  const id = cleanText(input.id, { maxLength: LIMITS.line });
  const departmentId = cleanText(input.departmentId, { maxLength: LIMITS.line });
  if (!departmentId) return fail("invalid");
  if (!(await departmentAllowed(actor, departmentId))) return fail("forbidden");

  const department = await prisma.department.findFirst({
    where: { id: departmentId, isActive: true },
    select: { id: true, name: true },
  });
  if (!department) return fail("not_found");

  if (!isReminderChannel(input.channel)) return fail("invalid");
  const offsetHours = Math.round(Number(input.offsetHours));
  if (!Number.isFinite(offsetHours) || offsetHours < 1 || offsetHours > 336) {
    return fail("invalid");
  }
  if (!isSmsEventKey(input.templateKey)) return fail("invalid");
  const quietStartHour = validHour(input.quietStartHour);
  const quietEndHour = validHour(input.quietEndHour);
  if (quietStartHour === undefined || quietEndHour === undefined) {
    return fail("invalid");
  }
  if (
    (quietStartHour === null) !== (quietEndHour === null) ||
    (quietStartHour !== null && quietStartHour === quietEndHour)
  ) {
    return fail("invalid");
  }
  const timezone = validTimezone(input.timezone);
  if (!timezone) return fail("invalid");
  const maxPerVisit = Math.round(Number(input.maxPerVisit ?? 2));
  if (!Number.isFinite(maxPerVisit) || maxPerVisit < 1 || maxPerVisit > 10) {
    return fail("invalid");
  }
  const isActive = input.isActive !== false && input.isActive !== "false";

  if (id) {
    const existing = await prisma.reminderRule.findFirst({
      where: { id, AND: [ruleScopeFor(actor)] },
      select: { id: true },
    });
    if (!existing) return fail("not_found");
  }

  const data = {
    departmentId,
    channel: input.channel,
    offsetHours,
    templateKey: input.templateKey,
    quietStartHour,
    quietEndHour,
    timezone,
    maxPerVisit,
    isActive,
  };

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const rule = id
        ? await tx.reminderRule.update({
            where: { id },
            data,
            select: { id: true },
          })
        : await tx.reminderRule.create({ data, select: { id: true } });

      await audit(tx, {
        entityType: "ReminderRule",
        entityId: rule.id,
        action: id
          ? `Oppdaterte påminnelsesregel for ${department.name}`
          : `Opprettet påminnelsesregel for ${department.name}`,
        actor: toAuditActor(actor),
        metadata: {
          departmentId,
          channel: data.channel,
          offsetHours,
          templateKey: data.templateKey,
          maxPerVisit,
          isActive,
        },
      });
      return rule;
    });
    return ok(saved);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return fail("conflict");
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return fail("not_found");
    }
    throw error;
  }
}

export async function deleteReminderRule(
  actor: ServiceActor,
  id: unknown,
): Promise<ServiceResult> {
  if (!actor?.isActive || !can(actor, "settings.manage")) {
    return fail("forbidden");
  }
  const ruleId = cleanText(id, { maxLength: LIMITS.line });
  if (!ruleId) return fail("invalid");

  const rule = await prisma.reminderRule.findFirst({
    where: { id: ruleId, AND: [ruleScopeFor(actor)] },
    select: {
      id: true,
      departmentId: true,
      offsetHours: true,
      channel: true,
      department: { select: { name: true } },
    },
  });
  if (!rule) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await audit(tx, {
      entityType: "ReminderRule",
      entityId: rule.id,
      action: `Slettet påminnelsesregel for ${rule.department.name}`,
      actor: toAuditActor(actor),
      metadata: {
        departmentId: rule.departmentId,
        offsetHours: rule.offsetHours,
        channel: rule.channel,
      },
    });
    await tx.reminderRule.delete({ where: { id: rule.id } });
  });
  return ok(undefined);
}

/** Kanalene en regel faktisk skal prøve. BEGGE gir én rad per kanal. */
function channelsFor(channel: string): Array<"SMS" | "EMAIL"> {
  if (channel === "BOTH") return ["SMS", "EMAIL"];
  if (channel === "EMAIL") return ["EMAIL"];
  return ["SMS"];
}

function quietReason(
  scheduledFor: Date,
  startsAt: Date,
  rule: ReminderRuleRow,
): Date {
  const deferred = deferForQuietHours(
    scheduledFor,
    rule.quietStartHour,
    rule.quietEndHour,
    rule.timezone,
  );
  return deferred >= startsAt ? scheduledFor : deferred;
}

type VisitForReminder = {
  id: string;
  startsAt: Date;
  workOrder: {
    id: string;
    title: string;
    reference: string;
    customerId: string | null;
    contactId: string | null;
    departmentId: string;
    technicians: Array<{ name: string | null }>;
    customer: {
      id: string;
      name: string;
      email: string | null;
      contacts: Array<{
        id: string;
        name: string;
        phone: string | null;
        email: string | null;
        locale: string;
      }>;
    } | null;
    contact: {
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
      locale: string;
    } | null;
  };
};

function recipientFor(
  visit: Pick<VisitForReminder, "workOrder">,
  channel: "SMS" | "EMAIL",
) {
  const direct = visit.workOrder.contact;
  const contacts = visit.workOrder.customer?.contacts ?? [];
  if (channel === "SMS") {
    if (direct?.phone) return direct;
    return contacts.find((contact) => contact.phone) ?? direct ?? contacts[0] ?? null;
  }
  if (direct?.email) return direct;
  return contacts.find((contact) => contact.email) ?? direct ?? contacts[0] ?? null;
}

async function emailAllowed(contactId: string | null): Promise<boolean> {
  if (!contactId) return true;
  const preference = await prisma.channelPreference.findUnique({
    where: { contactId_channel: { contactId, channel: "EMAIL" } },
    select: { optedOut: true },
  });
  return !preference?.optedOut;
}

/**
 * Planlegger påminnelser for visiter som er innenfor regelens vindu.
 * Funksjonen er idempotent: `dedupeKey` gjør at samme regel, visit,
 * starttid og kanal bare gir én rad, selv om flere instanser sveiper
 * samtidig.
 */
export async function scheduleDueReminders(
  now = new Date(),
): Promise<{ scheduled: number; skipped: number }> {
  const rules = (await prisma.reminderRule.findMany({
    where: { isActive: true, department: { isActive: true } },
    select: {
      id: true,
      departmentId: true,
      channel: true,
      offsetHours: true,
      templateKey: true,
      quietStartHour: true,
      quietEndHour: true,
      timezone: true,
      maxPerVisit: true,
      isActive: true,
    },
    take: 500,
  })) as ReminderRuleRow[];

  let scheduled = 0;
  let skipped = 0;

  for (const rule of rules) {
    const horizon = new Date(
      now.getTime() + rule.offsetHours * 60 * 60_000 + SCHEDULE_LOOKAHEAD_MS,
    );
    const visits = (await prisma.visit.findMany({
      where: {
        status: { in: ["PLANNED", "ASSIGNED"] },
        startsAt: { gt: now, lte: horizon },
        workOrder: {
          deletedAt: null,
          departmentId: rule.departmentId,
          status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
      },
      orderBy: { startsAt: "asc" },
      take: 200,
      select: {
        id: true,
        startsAt: true,
        workOrder: {
          select: {
            id: true,
            title: true,
            reference: true,
            customerId: true,
            contactId: true,
            departmentId: true,
            technicians: { select: { name: true }, take: 1 },
            customer: {
              select: {
                id: true,
                name: true,
                email: true,
                contacts: {
                  where: {
                    OR: [{ phone: { not: null } }, { email: { not: null } }],
                  },
                  orderBy: { name: "asc" },
                  take: 5,
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                    email: true,
                    locale: true,
                  },
                },
              },
            },
            contact: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                locale: true,
              },
            },
          },
        },
      },
    })) as VisitForReminder[];

    for (const visit of visits) {
      const start = visit.startsAt;
      for (const channel of channelsFor(rule.channel)) {
        const recipient = recipientFor(visit, channel);
        const dedupeKey = `reminder:${rule.id}:${visit.id}:${start.toISOString()}:${channel}`;
        const existing = await prisma.reminderDispatch.findUnique({
          where: { dedupeKey },
          select: { id: true },
        });
        if (existing) continue;

        const base = {
          ruleId: rule.id,
          visitId: visit.id,
          departmentId: visit.workOrder.departmentId,
          workOrderId: visit.workOrder.id,
          customerId: visit.workOrder.customerId,
          contactId: recipient?.id ?? null,
          channel,
          offsetHours: rule.offsetHours,
          locale: smsLocale(recipient?.locale),
          visitStartsAt: start,
          dedupeKey,
        };

        const createSkipped = async (skipReason: string) => {
          try {
            await prisma.reminderDispatch.create({
              data: {
                ...base,
                status: "SKIPPED",
                skipReason,
                scheduledFor: new Date(start.getTime() - rule.offsetHours * 60 * 60_000),
              },
            });
            skipped += 1;
          } catch (error) {
            if (!isUniqueViolation(error)) throw error;
          }
        };

        let recipientAvailable = true;
        if (channel === "SMS") {
          recipientAvailable = Boolean(recipient?.phone);
          if (recipientAvailable && recipient?.id) {
            recipientAvailable = await hasSmsConsent({ contactId: recipient.id });
            if (!recipientAvailable) continue; // Kan endre seg før visiten.
          }
        } else {
          recipientAvailable = Boolean(recipient?.email ?? visit.workOrder.customer?.email);
          if (recipientAvailable) {
            recipientAvailable = await emailAllowed(recipient?.id ?? null);
          }
        }
        if (!recipientAvailable) {
          await createSkipped(
            channel === "SMS" ? "missing_consent_or_phone" : "email_opt_out",
          );
          continue;
        }

        const activeCount = await prisma.reminderDispatch.count({
          where: {
            visitId: visit.id,
            status: { in: ["SCHEDULED", "PROCESSING", "SENT", "FAILED"] },
          },
        });
        if (activeCount >= rule.maxPerVisit) {
          await createSkipped("max_per_visit");
          continue;
        }

        const rawScheduledFor = new Date(
          start.getTime() - rule.offsetHours * 60 * 60_000,
        );
        const scheduledFor = quietReason(rawScheduledFor, start, rule);
        if (
          scheduledFor >= start ||
          isWithinQuietHours(
            scheduledFor,
            rule.quietStartHour,
            rule.quietEndHour,
            rule.timezone,
          )
        ) {
          await createSkipped("quiet_hours");
          continue;
        }

        try {
          await prisma.reminderDispatch.create({
            data: {
              ...base,
              status: "SCHEDULED",
              scheduledFor,
              nextAttemptAt: scheduledFor,
            },
          });
          scheduled += 1;
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      }
    }
  }

  return { scheduled, skipped };
}

type ClaimedDispatch = {
  id: string;
  ruleId: string;
  visitId: string;
  departmentId: string | null;
  workOrderId: string | null;
  customerId: string | null;
  contactId: string | null;
  channel: string;
  offsetHours: number;
  locale: string;
  status: string;
  scheduledFor: Date;
  visitStartsAt: Date;
  attempts: number;
  smsMessageId: string | null;
};

export async function claimReminderDispatch(): Promise<ClaimedDispatch | null> {
  const rows = await prisma.$queryRaw<ClaimedDispatch[]>`
    UPDATE "ReminderDispatch"
    SET "status" = 'PROCESSING',
        "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id"
      FROM "ReminderDispatch"
      WHERE "status" = 'SCHEDULED'
        AND "scheduledFor" <= now()
        AND "nextAttemptAt" <= now()
      ORDER BY "scheduledFor"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

/** Setter påminnelser som ble stående i PROCESSING tilbake i køen. */
export async function requeueStaleReminderDispatches(
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const result = await prisma.reminderDispatch.updateMany({
    where: { status: "PROCESSING", updatedAt: { lt: cutoff } },
    data: { status: "SCHEDULED", nextAttemptAt: now },
  });
  return result.count;
}

/**
 * Merker fremtidige påminnelser som ugyldige allerede ved neste sveip, uten å
 * vente til de forfaller. Da ser kontoret en avlyst eller flyttet visit i
 * historikken med en gang.
 */
export async function skipInvalidScheduledReminders(
  now = new Date(),
): Promise<number> {
  const rows = await prisma.reminderDispatch.findMany({
    where: { status: "SCHEDULED", scheduledFor: { gt: now } },
    orderBy: { scheduledFor: "asc" },
    take: 500,
    select: {
      id: true,
      visitStartsAt: true,
      visit: {
        select: {
          status: true,
          startsAt: true,
          workOrder: { select: { status: true, deletedAt: true } },
        },
      },
    },
  });

  let skipped = 0;
  for (const row of rows) {
    const reason = skipReasonForVisit(
      {
        status: row.visit.status,
        startsAt: row.visit.startsAt,
        workOrder: row.visit.workOrder,
      },
      row,
    );
    if (!reason) continue;
    await markSkipped(row.id, reason);
    skipped += 1;
  }
  return skipped;
}

function skipReasonForVisit(
  visit: {
    status: string;
    startsAt: Date;
    workOrder: { status: string; deletedAt: Date | null };
  },
  dispatch: { visitStartsAt: Date },
): string | null {
  if (visit.workOrder.deletedAt) return "work_order_deleted";
  if (visit.workOrder.status === "CANCELLED") return "work_order_cancelled";
  if (visit.workOrder.status === "COMPLETED" || visit.status === "DONE") {
    return "visit_completed";
  }
  if (visit.status === "CANCELLED") return "visit_cancelled";
  if (visit.startsAt.getTime() !== dispatch.visitStartsAt.getTime()) {
    return "visit_moved";
  }
  return null;
}

async function markSkipped(id: string, reason: string): Promise<void> {
  await prisma.reminderDispatch.update({
    where: { id },
    data: { status: "SKIPPED", skipReason: reason, lastError: null },
  });
}

async function ensureReminderThread(
  input: {
    customerId: string;
    contactId: string | null;
    workOrderId: string;
    departmentId: string | null;
    subject: string;
  },
  db: SmsDb = prisma,
): Promise<string> {
  const threadKey = messageThreadKey({
    customerId: input.customerId,
    contactId: input.contactId,
    workOrderId: input.workOrderId,
  });
  const thread = await db.messageThread.upsert({
    where: { threadKey },
    update: { lastMessageAt: new Date() },
    create: {
      threadKey,
      customerId: input.customerId,
      contactId: input.contactId,
      workOrderId: input.workOrderId,
      departmentId: input.departmentId,
      subject: input.subject.slice(0, 200),
      lastMessageAt: new Date(),
    },
    select: { id: true },
  });
  return thread.id;
}

/** Kjører én claimet påminnelse. */
export async function processReminderDispatch(
  dispatch: ClaimedDispatch,
): Promise<"sent" | "retry" | "skipped" | "failed"> {
  const visit = await prisma.visit.findUnique({
    where: { id: dispatch.visitId },
    select: {
      status: true,
      startsAt: true,
      workOrder: {
        select: {
          id: true,
          title: true,
          reference: true,
          status: true,
          deletedAt: true,
          departmentId: true,
          customerId: true,
          contactId: true,
          technicians: { select: { name: true }, take: 1 },
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              contacts: {
                where: {
                  OR: [{ phone: { not: null } }, { email: { not: null } }],
                },
                orderBy: { name: "asc" },
                take: 5,
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  email: true,
                  locale: true,
                },
              },
            },
          },
          contact: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              locale: true,
            },
          },
        },
      },
    },
  });
  if (!visit) {
    await markSkipped(dispatch.id, "visit_deleted");
    return "skipped";
  }

  const reason = skipReasonForVisit(visit, dispatch);
  if (reason) {
    await markSkipped(dispatch.id, reason);
    return "skipped";
  }

  const rule = await prisma.reminderRule.findUnique({
    where: { id: dispatch.ruleId },
    select: { isActive: true, templateKey: true },
  });
  if (!rule?.isActive) {
    await markSkipped(dispatch.id, "rule_inactive");
    return "skipped";
  }

  const workOrder = visit.workOrder;
  const recipient = recipientFor(
    visit,
    dispatch.channel === "EMAIL" ? "EMAIL" : "SMS",
  );
  const locale = smsLocale(recipient?.locale ?? dispatch.locale);
  const customerName = workOrder.customer?.name ?? "";

  try {
    if (dispatch.channel === "SMS") {
      if (!recipient?.id || !recipient.phone) {
        await markSkipped(dispatch.id, "missing_phone");
        return "skipped";
      }
      if (!(await hasSmsConsent({ contactId: recipient.id }))) {
        await markSkipped(dispatch.id, "no_consent");
        return "skipped";
      }
      const phone = recipient.phone;

      const branding = await prisma.branding.findFirst({
        select: { companyName: true },
      });
      const rendered = await renderEventSms(
        rule.templateKey as SmsEventKey,
        locale,
        {
          contactName: recipient.name,
          customerName,
          companyName: branding?.companyName ?? "",
          workOrderTitle: workOrder.title,
          date: formatDateLocalized(visit.startsAt, locale, {
            dateStyle: "medium",
          }),
          time: new Intl.DateTimeFormat(locale === "nb" ? "nb-NO" : locale, {
            timeZone: "Europe/Oslo",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).format(visit.startsAt),
          reference: workOrder.reference,
          technicianName: workOrder.technicians[0]?.name ?? "",
        },
      );
      if (!rendered.ok) {
        await markSkipped(dispatch.id, "missing_template");
        return "skipped";
      }

      const threadCustomerId =
        workOrder.customerId ?? workOrder.customer?.id ?? null;
      if (!threadCustomerId) {
        await markSkipped(dispatch.id, "missing_customer");
        return "skipped";
      }
      const queued = await prisma.$transaction(async (tx) => {
        const threadId = await ensureReminderThread(
          {
            customerId: threadCustomerId,
            contactId: recipient.id,
            workOrderId: workOrder.id,
            departmentId: workOrder.departmentId,
            subject: workOrder.title,
          },
          tx,
        );

        const sms = await enqueueSms({
          to: phone,
          body: rendered.data.body,
          contactId: recipient.id,
          workOrderId: workOrder.id,
          departmentId: workOrder.departmentId,
          threadId,
          locale,
          templateKey: rule.templateKey,
          db: tx,
        });
        if (!sms.ok) {
          return { ok: false as const, reason: sms.reason };
        }

        await tx.message.create({
          data: {
            threadId,
            direction: "OUTBOUND",
            channel: "SMS",
            body: rendered.data.body,
            smsMessageId: sms.data.id,
            toAddress: recipient.phone,
          },
        });
        await tx.reminderDispatch.update({
          where: { id: dispatch.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            smsMessageId: sms.data.id,
            lastError: null,
          },
        });
        return { ok: true as const, reason: null };
      });
      if (!queued.ok) {
        if (queued.reason === "forbidden") {
          await markSkipped(dispatch.id, "no_consent");
          return "skipped";
        }
        throw new Error(queued.reason ?? "sms_failed");
      }
    } else {
      const email = recipient?.email ?? workOrder.customer?.email ?? null;
      if (!email) {
        await markSkipped(dispatch.id, "missing_email");
        return "skipped";
      }
      if (!(await emailAllowed(recipient?.id ?? null))) {
        await markSkipped(dispatch.id, "email_opt_out");
        return "skipped";
      }

      const branding = await prisma.branding.findFirst({
        select: { companyName: true },
      });
      const content = reminderEmailContent({
        locale,
        contactName: recipient?.name ?? "",
        customerName,
        companyName: branding?.companyName ?? "",
        workOrderTitle: workOrder.title,
        start: visit.startsAt,
        offsetHours: dispatch.offsetHours,
        reference: workOrder.reference,
      });
      const delivered = await sendNotificationEmail(
        email,
        content.subject,
        content.body,
        "/kundeportal/meldinger",
      );
      if (!delivered) throw new Error("smtp_not_configured");

      await prisma.reminderDispatch.update({
        where: { id: dispatch.id },
        data: { status: "SENT", sentAt: new Date(), lastError: null },
      });
    }

    try {
      await prisma.$transaction(async (tx) => {
        await audit(tx, {
          entityType: "ReminderDispatch",
          entityId: dispatch.id,
          action:
            dispatch.channel === "SMS"
              ? `Sendte SMS-påminnelse ${dispatch.offsetHours} timer før besøk`
              : `Sendte e-postpåminnelse ${dispatch.offsetHours} timer før besøk`,
          actor: { id: "system", name: "System", email: null },
          metadata: {
            ruleId: dispatch.ruleId,
            visitId: dispatch.visitId,
            channel: dispatch.channel,
            offsetHours: dispatch.offsetHours,
            automatic: true,
          },
        });
      });
    } catch (error) {
      // Sendingen er allerede fullført. En revisjonsfeil skal ikke gi en ny
      // utsending av samme påminnelse.
      logger.error("Could not audit reminder dispatch", {
        dispatchId: dispatch.id,
        error: safeReminderError(error),
      });
    }

    return "sent";
  } catch (error) {
    const message = safeReminderError(error);
    if (dispatch.attempts >= REMINDER_MAX_ATTEMPTS) {
      await prisma.reminderDispatch.update({
        where: { id: dispatch.id },
        data: { status: "FAILED", lastError: message },
      });
      logger.error("Reminder dispatch failed after maximum attempts", {
        dispatchId: dispatch.id,
        channel: dispatch.channel,
        attempts: dispatch.attempts,
        error: message,
      });
      return "failed";
    }

    const delay = REMINDER_RETRY_BASE_MS * 2 ** (dispatch.attempts - 1);
    await prisma.reminderDispatch.update({
      where: { id: dispatch.id },
      data: {
        status: "SCHEDULED",
        nextAttemptAt: new Date(Date.now() + delay),
        lastError: message,
      },
    });
    logger.warn("Reminder dispatch failed; retrying", {
      dispatchId: dispatch.id,
      channel: dispatch.channel,
      attempts: dispatch.attempts,
    });
    return "retry";
  }
}

/** PII-fri feilkode for logg og historikk. */
export function safeReminderError(error: unknown): string {
  if (error && typeof error === "object") {
    const name = "name" in error ? String((error as { name?: unknown }).name) : "";
    const code = "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code) return code.slice(0, 100);
    if (name) return name.slice(0, 100);
  }
  return "reminder_failed";
}

export async function processReminderDispatches(
  limit = 20,
): Promise<{ processed: number; sent: number; skipped: number; failed: number }> {
  let processed = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (let index = 0; index < Math.max(1, limit); index += 1) {
    const dispatch = await claimReminderDispatch();
    if (!dispatch) break;
    processed += 1;
    const outcome = await processReminderDispatch(dispatch);
    if (outcome === "sent") sent += 1;
    if (outcome === "skipped") skipped += 1;
    if (outcome === "failed") failed += 1;
  }
  return { processed, sent, skipped, failed };
}

/** Ett sveip: planlegg nye påminnelser og send de som er forfalt. */
export async function runReminderCycle(
  now = new Date(),
): Promise<{
  scheduled: number;
  skipped: number;
  processed: number;
  sent: number;
  failed: number;
}> {
  await requeueStaleReminderDispatches(now);
  const invalid = await skipInvalidScheduledReminders(now);
  const planned = await scheduleDueReminders(now);
  const sent = await processReminderDispatches(25);
  if (planned.scheduled > 0 || sent.sent > 0 || sent.failed > 0 || invalid > 0) {
    logger.info("Reminder cycle completed", {
      invalid,
      scheduled: planned.scheduled,
      skipped: planned.skipped,
      processed: sent.processed,
      sent: sent.sent,
      failed: sent.failed,
    });
  }
  return {
    scheduled: planned.scheduled,
    skipped: planned.skipped,
    processed: sent.processed,
    sent: sent.sent,
    failed: sent.failed,
  };
}

type ReminderWorkerGlobal = typeof globalThis & {
  __fsmReminderWorkerStarted?: boolean;
};

/**
 * Starter påminnelsesworkeren. Den har eget startflagg, slik at både
 * jobbworkeren og `instrumentation.ts` kan kalle den uten å lage to
 * intervaller. Workeren kjører også når PDF-jobben er slått av.
 */
export function startReminderWorker(): void {
  const scope = globalThis as ReminderWorkerGlobal;
  if (scope.__fsmReminderWorkerStarted) return;
  scope.__fsmReminderWorkerStarted = true;

  const run = () => {
    void runReminderCycle().catch((error) => {
      logger.error("Could not run the reminder cycle", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  run();
  const timer = setInterval(run, REMINDER_SWEEP_INTERVAL_MS);
  timer.unref?.();
  logger.info("Reminder worker started");
}

export function resetReminderWorkerForTests(): void {
  const scope = globalThis as ReminderWorkerGlobal;
  scope.__fsmReminderWorkerStarted = false;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
