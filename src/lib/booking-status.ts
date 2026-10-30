/**
 * Statusregler for kundebestillinger.
 *
 * Bestillingen har sin egen livssyklus, atskilt fra oppdragets status:
 *
 *   PENDING → CONFIRMED → CANCELLED
 *          ↘ CANCELLED
 *          ↘ EXPIRED
 *
 * `CONFIRMED` betyr at kontoret (eller den direkte slotflyten) har bundet
 * bestillingen til en konkret visitt. `PENDING` beholdes for eldre
 * forespørsler som venter på manuell bekreftelse i kontorkøen.
 */

export const BOOKING_REQUEST_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
] as const;

export type BookingRequestStatusValue =
  (typeof BOOKING_REQUEST_STATUSES)[number];

/** Statusene kundeportalen viser som egne merker. */
export type BookingDisplayStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "expired";

const CANCELLABLE_WORK_ORDER_STATUSES = [
  "OPEN",
  "PENDING",
  "PLANNED",
  "WAITING",
] as const;

export function isBookingRequestStatus(
  value: unknown,
): value is BookingRequestStatusValue {
  return (
    typeof value === "string" &&
    (BOOKING_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

/** PENDING og CONFIRMED er åpne; de tre andre er lukkede tilstander. */
export function isOpenBookingStatus(status: string): boolean {
  return status === "PENDING" || status === "CONFIRMED";
}

export function isTerminalBookingStatus(status: string): boolean {
  return (
    status === "CANCELLED" || status === "EXPIRED" || status === "COMPLETED"
  );
}

export function isCancellableWorkOrderStatus(status: string): boolean {
  return (CANCELLABLE_WORK_ORDER_STATUSES as readonly string[]).includes(
    status,
  );
}

/**
 * Kunden kan kansellere både en ubekreftet forespørsel og en bekreftet
 * avtale, så lenge oppdraget ikke er i gang eller avsluttet.
 */
export function canCustomerCancelBooking(
  bookingStatus: string,
  workOrderStatus: string,
): boolean {
  if (!isOpenBookingStatus(bookingStatus)) return false;
  if (workOrderStatus === "COMPLETED" || workOrderStatus === "CANCELLED") {
    return false;
  }
  // En ubekreftet forespørsel kan alltid trekkes tilbake; den avlyser ikke et
  // oppdrag som allerede er i gang. En bekreftet avtale er derimot låst når
  // arbeidet har startet.
  if (bookingStatus === "PENDING") return true;
  if (workOrderStatus === "IN_PROGRESS") return false;
  return true;
}

/**
 * Ny tid krever at endringsfristen (24 timer før avtalt start) fortsatt er
 * holdt. Gjelder både PENDING og CONFIRMED.
 */
export function canCustomerRescheduleBooking(
  bookingStatus: string,
  workOrderStatus: string,
  changeDeadline: Date,
  now = new Date(),
): boolean {
  if (!isOpenBookingStatus(bookingStatus)) return false;
  if (workOrderStatus === "COMPLETED" || workOrderStatus === "CANCELLED") {
    return false;
  }
  if (workOrderStatus === "IN_PROGRESS") return false;
  return now.getTime() < changeDeadline.getTime();
}

/**
 * Merket kunden ser. Et bekreftet oppdrag som er fullført vises som
 * «fullført»; en avlyst bestilling eller et avlyst oppdrag som «avlyst».
 */
export function bookingDisplayStatus(
  bookingStatus: string,
  workOrderStatus: string,
): BookingDisplayStatus {
  if (bookingStatus === "EXPIRED") return "expired";
  if (bookingStatus === "CANCELLED" || workOrderStatus === "CANCELLED") {
    return "cancelled";
  }
  if (workOrderStatus === "COMPLETED") return "completed";
  if (bookingStatus === "PENDING") return "pending";
  if (bookingStatus === "CONFIRMED") return "confirmed";
  return "pending";
}

/** Stabile oversettelsesnøkler for merkene. */
export const BOOKING_DISPLAY_STATUS_KEYS: Record<
  BookingDisplayStatus,
  string
> = {
  pending: "portal.bookingRequests.status.pending",
  confirmed: "portal.bookingRequests.status.confirmed",
  completed: "portal.bookingRequests.status.completed",
  cancelled: "portal.bookingRequests.status.cancelled",
  expired: "portal.bookingRequests.status.expired",
};
