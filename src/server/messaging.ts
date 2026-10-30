// i18n-ignore-file: revisjonsloggen lagrer stabile handlingsstrenger på samme
// måte som de øvrige tjenestene; de oversettes ved visning.
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { cleanText, LIMITS } from "@/lib/sanitize";
import { phonesMatch } from "@/lib/sms/phone";
import type { SmsProviderName } from "@/lib/sms/provider";
import { smsConsentAction } from "@/lib/sms/templates";
import {
  applyInboundConsent,
  enqueueSms,
  getSmsSettings,
  hasSmsConsent,
  type SmsDb,
} from "./sms";
import { notifyUser } from "./notifications";
import {
  can,
  fail,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/** Avdelingssperren for meldingstråder, lik oppdragenes. */
export function messageThreadScopeFor(
  actor: ServiceActor,
): Prisma.MessageThreadWhereInput {
  if (!actor?.isActive) return { id: { in: [] } };
  if (actor.role === "ADMIN") return {};
  if (actor.role === "CUSTOMER") {
    return actor.customerId
      ? { customerId: actor.customerId }
      : { id: { in: [] } };
  }
  if (
    !can(actor, "workorders.view") &&
    !can(actor, "workorders.update") &&
    !can(actor, "workorders.edit")
  ) {
    return { id: { in: [] } };
  }
  if (!actor.departmentId) return { id: { in: [] } };
  return {
    departmentId: actor.departmentId,
    department: { isActive: true },
  };
}

export function messageThreadKey(input: {
  customerId: string;
  contactId?: string | null;
  workOrderId?: string | null;
}): string {
  return `customer:${input.customerId}:contact:${input.contactId ?? "none"}:wo:${
    input.workOrderId ?? "none"
  }`;
}

export type MessageThreadListOptions = {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
  workOrderId?: string | null;
  customerId?: string | null;
  query?: string | null;
};

const THREAD_PAGE_SIZE = 25;

export async function listMessageThreads(
  actor: ServiceActor,
  options: MessageThreadListOptions = {},
) {
  if (!actor?.isActive) return fail("forbidden");
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(
    50,
    Math.max(1, options.pageSize ?? THREAD_PAGE_SIZE),
  );
  const query = cleanText(options.query, { maxLength: 100 });
  const workOrderId = cleanText(options.workOrderId, { maxLength: LIMITS.line });
  const customerId = cleanText(options.customerId, { maxLength: LIMITS.line });

  const where: Prisma.MessageThreadWhereInput = {
    AND: [
      messageThreadScopeFor(actor),
      ...(options.unreadOnly ? [{ unreadCount: { gt: 0 } }] : []),
      ...(workOrderId ? [{ workOrderId }] : []),
      ...(customerId ? [{ customerId }] : []),
      ...(query
        ? [
            {
              OR: [
                { customer: { name: { contains: query, mode: "insensitive" } } },
                { contact: { name: { contains: query, mode: "insensitive" } } },
                { workOrder: { title: { contains: query, mode: "insensitive" } } },
              ],
            } satisfies Prisma.MessageThreadWhereInput,
          ]
        : []),
    ],
  };

  const [total, unread, threads] = await Promise.all([
    prisma.messageThread.count({ where }),
    prisma.messageThread.count({
      where: {
        AND: [messageThreadScopeFor(actor), { unreadCount: { gt: 0 } }],
      },
    }),
    prisma.messageThread.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, phone: true, locale: true } },
        workOrder: { select: { id: true, title: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);

  return ok({
    threads,
    total,
    unread,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
}

export async function countUnreadMessageThreads(
  actor: ServiceActor,
): Promise<number> {
  if (!actor?.isActive) return 0;
  return prisma.messageThread.count({
    where: {
      AND: [messageThreadScopeFor(actor), { unreadCount: { gt: 0 } }],
    },
  });
}

export async function getMessageThread(
  actor: ServiceActor,
  threadId: unknown,
  options: { markRead?: boolean } = {},
) {
  if (!actor?.isActive) return fail("forbidden");
  const id = cleanText(threadId, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  const thread = await prisma.messageThread.findFirst({
    where: { id, AND: [messageThreadScopeFor(actor)] },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      contact: {
        select: { id: true, name: true, phone: true, email: true, locale: true },
      },
      workOrder: { select: { id: true, title: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });
  if (!thread) return fail("not_found");

  const consent = thread.contactId
    ? await hasSmsConsent({ contactId: thread.contactId })
    : false;

  const smsRows = await prisma.smsMessage.findMany({
    where: { threadId: thread.id, direction: "OUTBOUND" },
    select: { id: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const smsStatuses: Record<string, string> = {};
  for (const row of smsRows) smsStatuses[row.id] = row.status;

  if (options.markRead !== false && thread.unreadCount > 0) {
    await prisma.$transaction([
      prisma.messageThread.update({
        where: { id: thread.id },
        data: { unreadCount: 0 },
      }),
      prisma.message.updateMany({
        where: { threadId: thread.id, direction: "INBOUND", readAt: null },
        data: { readAt: new Date() },
      }),
    ]);
  }

  return ok({
    thread: { ...thread, messages: [...thread.messages].reverse() },
    consent,
    smsStatuses,
  });
}

export async function markMessageThreadRead(
  actor: ServiceActor,
  threadId: unknown,
): Promise<ServiceResult> {
  if (!actor?.isActive) return fail("forbidden");
  const id = cleanText(threadId, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  const thread = await prisma.messageThread.findFirst({
    where: { id, AND: [messageThreadScopeFor(actor)] },
    select: { id: true },
  });
  if (!thread) return fail("not_found");

  await prisma.$transaction([
    prisma.messageThread.update({
      where: { id: thread.id },
      data: { unreadCount: 0 },
    }),
    prisma.message.updateMany({
      where: { threadId: thread.id, direction: "INBOUND", readAt: null },
      data: { readAt: new Date() },
    }),
  ]);
  return ok(undefined);
}

/**
 * Finner eller oppretter tråden som hører til et oppdrag. Tråden arver
 * avdeling og kunde fra oppdraget, slik at kontoret ser den på riktig sted.
 */
export async function ensureThreadForWorkOrder(
  actor: ServiceActor,
  workOrderId: unknown,
  contactIdOverride?: string | null,
  db: SmsDb = prisma,
) {
  if (!actor?.isActive) return fail("forbidden");
  const id = cleanText(workOrderId, { maxLength: LIMITS.line });
  if (!id) return fail("invalid");

  const workOrder = await db.workOrder.findFirst({
    where: {
      id,
      deletedAt: null,
      ...(actor.role === "ADMIN"
        ? {}
        : actor.role === "CUSTOMER"
          ? { customerId: actor.customerId ?? "__none__" }
          : { departmentId: actor.departmentId ?? "__none__" }),
    },
    select: {
      id: true,
      title: true,
      customerId: true,
      contactId: true,
      departmentId: true,
    },
  });
  if (!workOrder) return fail("not_found");
  if (!workOrder.customerId) return fail("invalid");

  let contactId =
    cleanText(contactIdOverride, { maxLength: LIMITS.line }) ||
    workOrder.contactId;
  if (!contactId) {
    const fallbackContact = await db.contact.findFirst({
      where: { customerId: workOrder.customerId, phone: { not: null } },
      select: { id: true },
      orderBy: { name: "asc" },
    });
    contactId = fallbackContact?.id ?? null;
  }

  const threadKey = messageThreadKey({
    customerId: workOrder.customerId,
    contactId,
    workOrderId: workOrder.id,
  });

  const thread = await db.messageThread.upsert({
    where: { threadKey },
    update: {},
    create: {
      threadKey,
      customerId: workOrder.customerId,
      departmentId: workOrder.departmentId,
      workOrderId: workOrder.id,
      contactId,
      subject: workOrder.title.slice(0, 200),
      lastMessageAt: new Date(),
    },
    select: { id: true },
  });

  return ok({ id: thread.id });
}

export async function sendThreadMessage(
  actor: ServiceActor,
  threadId: unknown,
  body: unknown,
  options: { templateKey?: string | null; db?: SmsDb } = {},
) {
  const isOwnCustomer = actor?.role === "CUSTOMER" && Boolean(actor.customerId);
  if (
    !actor?.isActive ||
    (!isOwnCustomer &&
      !can(actor, "workorders.update") &&
      !can(actor, "workorders.edit") &&
      !can(actor, "customers.manage"))
  ) {
    return fail("forbidden");
  }
  const id = cleanText(threadId, { maxLength: LIMITS.line });
  const text = cleanText(body, { maxLength: 1600, multiline: true });
  if (!id || !text) return fail("invalid");
  const db = options.db ?? prisma;

  const thread = await db.messageThread.findFirst({
    where: { id, AND: [messageThreadScopeFor(actor)] },
    select: {
      id: true,
      customerId: true,
      contactId: true,
      workOrderId: true,
      departmentId: true,
      workOrder: { select: { contactId: true } },
      contact: { select: { id: true, phone: true, locale: true } },
    },
  });
  if (!thread) return fail("not_found");

  const contactId = thread.contactId ?? thread.workOrder?.contactId ?? null;
  const fallbackContact =
    contactId && !thread.contact
      ? await db.contact.findUnique({
          where: { id: contactId },
          select: { phone: true, locale: true },
        })
      : null;
  const phone = thread.contact?.phone ?? fallbackContact?.phone ?? null;
  if (!contactId || !phone) return fail("invalid_contact");

  const queued = await enqueueSms({
    to: phone,
    body: text,
    contactId,
    workOrderId: thread.workOrderId,
    departmentId: thread.departmentId,
    threadId: thread.id,
    locale: thread.contact?.locale ?? fallbackContact?.locale ?? "nb",
    templateKey: options.templateKey ?? null,
    db,
  });
  if (!queued.ok) {
    return queued.reason === "forbidden"
      ? fail("forbidden", { code: "sms.errors.noConsent" })
      : queued;
  }

  const message = await db.message.create({
    data: {
      threadId: thread.id,
      direction: "OUTBOUND",
      channel: "SMS",
      body: text,
      authorUserId: actor.id,
      smsMessageId: queued.data.id,
      toAddress: phone,
    },
    select: { id: true },
  });
  await db.messageThread.update({
    where: { id: thread.id },
    data: { lastMessageAt: new Date() },
  });

  await audit(db as Prisma.TransactionClient, {
    entityType: "MessageThread",
    entityId: thread.id,
    action: "Sendte SMS fra meldingstråden",
    actor: toAuditActor(actor),
    metadata: { smsMessageId: queued.data.id, messageId: message.id },
  });

  return ok({ messageId: message.id, smsMessageId: queued.data.id });
}

export type InboundSmsInput = {
  provider: SmsProviderName;
  providerId: string;
  from: string;
  to: string;
  body: string;
  receivedAt?: Date | null;
};

export type InboundSmsResult = {
  duplicate: boolean;
  threadId: string | null;
  contactId: string | null;
  customerId: string | null;
  consentAction: "OPT_OUT" | "OPT_IN" | null;
};

type PhoneMatch = {
  contactId: string | null;
  userId: string | null;
  customerId: string | null;
  name: string | null;
  locale: string;
  departmentId: string | null;
};

/**
 * Kobler et innkommende nummer til kontakt, kunde eller ansatt. Numre lagres
 * i ulike formater, så sammenligningen gjøres på normaliserte sifre.
 */
async function matchInboundSender(from: string): Promise<PhoneMatch | null> {
  const [contacts, users, customers] = await Promise.all([
    prisma.contact.findMany({
      where: { phone: { not: null } },
      select: {
        id: true,
        name: true,
        phone: true,
        locale: true,
        customerId: true,
        customer: { select: { name: true, departmentId: true } },
      },
      take: 500,
    }),
    prisma.user.findMany({
      where: { phone: { not: null }, role: { not: "CUSTOMER" } },
      select: {
        id: true,
        name: true,
        phone: true,
        locale: true,
        customerId: true,
        departmentId: true,
      },
      take: 200,
    }),
    prisma.customer.findMany({
      where: { phone: { not: null }, deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        departmentId: true,
      },
      take: 200,
    }),
  ]);

  const contact = contacts.find((row) => phonesMatch(row.phone, from));
  if (contact) {
    return {
      contactId: contact.id,
      userId: null,
      customerId: contact.customerId,
      name: contact.name,
      locale: contact.locale,
      departmentId: contact.customer?.departmentId ?? null,
    };
  }

  const user = users.find((row) => phonesMatch(row.phone, from));
  if (user?.customerId) {
    return {
      contactId: null,
      userId: user.id,
      customerId: user.customerId,
      name: user.name,
      locale: user.locale,
      departmentId: user.departmentId,
    };
  }

  const customer = customers.find((row) => phonesMatch(row.phone, from));
  if (customer) {
    return {
      contactId: null,
      userId: null,
      customerId: customer.id,
      name: customer.name,
      locale: "nb",
      departmentId: customer.departmentId,
    };
  }

  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * Lagrer én innkommende webhook-levering. Unikheten på
 * `(provider, providerId)` gjør at samme levering bare gir én melding, også
 * når leverandøren prøver på nytt.
 */
export async function recordInboundSms(
  input: InboundSmsInput,
): Promise<InboundSmsResult> {
  const existing = await prisma.smsMessage.findUnique({
    where: {
      provider_providerId: {
        provider: input.provider,
        providerId: input.providerId,
      },
    },
    select: { id: true, threadId: true, contactId: true },
  });
  if (existing) {
    const thread = existing.threadId
      ? await prisma.messageThread.findUnique({
          where: { id: existing.threadId },
          select: { customerId: true },
        })
      : null;
    return {
      duplicate: true,
      threadId: existing.threadId,
      contactId: existing.contactId,
      customerId: thread?.customerId ?? null,
      consentAction: null,
    };
  }

  const match = await matchInboundSender(input.from);
  const settings = await getSmsSettings();
  const consentAction = smsConsentAction(
    input.body,
    settings.optOutKeywords,
    settings.optInKeywords,
  );

  try {
    const saved = await prisma.$transaction(async (tx) => {
      const sms = await tx.smsMessage.create({
        data: {
          direction: "INBOUND",
          provider: input.provider,
          providerId: input.providerId,
          to: input.to.slice(0, LIMITS.line),
          from: input.from.slice(0, LIMITS.line),
          body: input.body.slice(0, 1600),
          status: "RECEIVED",
          contactId: match?.contactId ?? null,
          userId: match?.userId ?? null,
          departmentId: match?.departmentId ?? null,
          sentAt: input.receivedAt ?? new Date(),
        },
        select: { id: true },
      });

      if (consentAction) {
        await applyInboundConsent(tx, {
          contactId: match?.contactId,
          userId: match?.userId,
          action: consentAction,
          source: `SMS ${consentAction === "OPT_OUT" ? "STOP" : "START"}`,
        });
      }

      if (!match?.customerId) {
        return { smsId: sms.id, threadId: null as string | null };
      }

      const threadKey = messageThreadKey({
        customerId: match.customerId,
        contactId: match.contactId,
      });
      const thread = await tx.messageThread.upsert({
        where: { threadKey },
        update: {
          lastMessageAt: new Date(),
          unreadCount: { increment: 1 },
        },
        create: {
          threadKey,
          customerId: match.customerId,
          departmentId: match.departmentId,
          contactId: match.contactId,
          unreadCount: 1,
          lastMessageAt: new Date(),
        },
        select: { id: true },
      });

      await tx.message.create({
        data: {
          threadId: thread.id,
          direction: "INBOUND",
          channel: "SMS",
          body: input.body.slice(0, 1600),
          smsMessageId: sms.id,
          fromAddress: input.from.slice(0, LIMITS.line),
          toAddress: input.to.slice(0, LIMITS.line),
        },
      });
      await tx.smsMessage.update({
        where: { id: sms.id },
        data: { threadId: thread.id, contactId: match.contactId },
      });

      return { smsId: sms.id, threadId: thread.id };
    });

    if (saved.threadId && match?.customerId && !consentAction) {
      await notifyInboundMessage({
        threadId: saved.threadId,
        departmentId: match.departmentId,
        id: saved.smsId,
        name: match.name,
        preview: input.body,
      });
    }

    return {
      duplicate: false,
      threadId: saved.threadId,
      contactId: match?.contactId ?? null,
      customerId: match?.customerId ?? null,
      consentAction,
    };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        duplicate: true,
        threadId: null,
        contactId: null,
        customerId: null,
        consentAction: null,
      };
    }
    throw error;
  }
}

async function notifyInboundMessage(input: {
  threadId: string;
  departmentId: string | null;
  id: string;
  name: string | null;
  preview: string;
}): Promise<void> {
  if (!input.departmentId) return;
  const office = await prisma.user.findMany({
    where: {
      departmentId: input.departmentId,
      role: { in: ["ADMIN", "OFFICE"] },
      isActive: true,
    },
    select: { id: true },
    take: 100,
  });

  for (const user of office) {
    await notifyUser({
      userId: user.id,
      type: "MESSAGE",
      titleKey: "sms.notifications.title",
      bodyKey: "sms.notifications.body",
      params: {
        name: input.name ?? "",
        preview: input.preview.slice(0, 120),
      },
      href: `/meldinger/${input.threadId}`,
      dedupeKey: `sms:${input.id}:${user.id}`,
    });
  }
}
