// i18n-ignore-file: tjenesten har ingen direkte UI-tekst; malene ligger i
// databasen og oversettes per mottaker-locale.
import prisma from "@/lib/prisma";
import { formatDateLocalized } from "@/lib/dates";
import { logger } from "@/lib/logger";
import { cleanText, LIMITS } from "@/lib/sanitize";
import {
  isSmsEventKey,
  smsLocale,
  type SmsEventKey,
  type SmsTemplateValues,
} from "@/lib/sms/templates";
import { can, fail, ok, type ServiceActor, type ServiceResult } from "./actor";
import { ensureThreadForWorkOrder, sendThreadMessage } from "./messaging";
import { renderEventSms, type SmsDb } from "./sms";

type SendEventInput = {
  workOrderId: unknown;
  eventKey: unknown;
  extra?: SmsTemplateValues;
  /** 5A kan sende med sin transaksjon, slik at køraden committes atomisk. */
  db?: SmsDb;
};

function firstPhoneRecipient(
  workOrder: {
    contact: {
      id: string;
      name: string;
      locale: string;
      phone: string | null;
    } | null;
    customer: {
      name: string;
      contacts: Array<{
        id: string;
        name: string;
        locale: string;
        phone: string | null;
      }>;
    } | null;
  },
) {
  if (workOrder.contact?.phone) return workOrder.contact;
  return workOrder.customer?.contacts[0] ?? null;
}

/**
 * Sender en hendelses-SMS til oppdragets kontaktperson.
 *
 * 5A-kobling: bookingtjenestene kaller denne med `BOOKING_CONFIRMED` i samme
 * transaksjon som bestillingen bekreftes. Funksjonen refererer bevisst ikke
 * til `BookingRequestStatus.CONFIRMED`, slik at SMS-laget kan testes uten
 * bookingmodellene. Se `docs/DECISIONS.md`.
 */
export async function sendWorkOrderEventSms(
  actor: ServiceActor,
  input: SendEventInput,
): Promise<ServiceResult<{ threadId: string; messageId: string }>> {
  if (!isSmsEventKey(input.eventKey)) return fail("invalid");

  const canStaff =
    can(actor, "workorders.update") || can(actor, "workorders.edit");
  // Kundeportalen bekrefter bookinger selv. Bare den egne, bekreftede
  // bookingen kan trigge denne malen; øvrige hendelser er kontorinterne.
  const canOwnBooking =
    actor?.role === "CUSTOMER" &&
    Boolean(actor.customerId) &&
    input.eventKey === "BOOKING_CONFIRMED";
  if (!actor?.isActive || (!canStaff && !canOwnBooking)) {
    return fail("forbidden");
  }

  const workOrderId = cleanText(input.workOrderId, {
    maxLength: LIMITS.line,
  });
  if (!workOrderId) return fail("invalid");

  const db = input.db ?? prisma;
  const workOrder = await db.workOrder.findFirst({
    where: {
      id: workOrderId,
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
      orderNumber: true,
      scheduledFor: true,
      departmentId: true,
      contact: { select: { id: true, name: true, locale: true, phone: true } },
      customer: {
        select: {
          name: true,
          contacts: {
            where: { phone: { not: null } },
            select: { id: true, name: true, locale: true, phone: true },
            take: 1,
          },
        },
      },
      technicians: { select: { name: true }, take: 1 },
    },
  });
  if (!workOrder) return fail("not_found");

  const recipient = firstPhoneRecipient(workOrder);
  if (!recipient || !("phone" in recipient && recipient.phone)) {
    return fail("missing_contact");
  }

  const locale = smsLocale(recipient.locale);
  const branding = await db.branding.findFirst({
    select: { companyName: true },
  });

  const rendered = await renderEventSms(input.eventKey, locale, {
    contactName: recipient.name,
    customerName: workOrder.customer?.name ?? "",
    companyName: branding?.companyName ?? "",
    workOrderTitle: workOrder.title,
    date: workOrder.scheduledFor
      ? formatDateLocalized(workOrder.scheduledFor, locale)
      : "",
    time: "",
    reference: workOrder.orderNumber ?? workOrder.id,
    technicianName: workOrder.technicians[0]?.name ?? "",
    ...input.extra,
  });
  if (!rendered.ok) return rendered;

  const thread = await ensureThreadForWorkOrder(
    actor,
    workOrderId,
    recipient.id,
    db,
  );
  if (!thread.ok) return thread;

  const sent = await sendThreadMessage(
    actor,
    thread.data.id,
    rendered.data.body,
    { templateKey: input.eventKey, db },
  );
  if (!sent.ok) return sent;

  return ok({
    threadId: thread.data.id,
    messageId: sent.data.messageId,
  });
}

/**
 * Beste-forsøk-variant for bookingtransaksjonen. En manglende kontakt, manglende
 * samtykke eller SMS-feil skal aldri velte selve bookingen.
 */
export async function trySendBookingConfirmedSms(
  actor: ServiceActor,
  workOrderId: string,
  extra: SmsTemplateValues,
  db: SmsDb,
): Promise<void> {
  try {
    const result = await sendBookingConfirmedSms(actor, workOrderId, extra, db);
    if (!result.ok) {
      if (result.reason !== "forbidden" && result.reason !== "missing_contact") {
        logger.warn("Booking confirmation SMS was not queued", {
          workOrderId,
          reason: result.reason,
        });
      }
    }
  } catch (error) {
    // En SMS-feil skal ikke rulle tilbake en bekreftet booking.
    logger.error("Booking confirmation SMS failed", {
      workOrderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Kort alias for bookingbekreftelsen. Bookingtjenestene bruker dette navnet,
 * slik at 5A-koblingen ikke avhenger av den generelle hendelsesservicen.
 */
export function sendBookingConfirmedSms(
  actor: ServiceActor,
  workOrderId: string,
  extra: SmsTemplateValues = {},
  db?: SmsDb,
) {
  return sendWorkOrderEventSms(actor, {
    workOrderId,
    eventKey: "BOOKING_CONFIRMED" satisfies SmsEventKey,
    extra,
    db,
  });
}
