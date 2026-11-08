/**
 * Hendelsesnøklene for transaksjons-e-post.
 *
 * Modulen er ren data uten databaseavhengigheter, slik at både utboksen,
 * malene, innstillingene og testene bruker samme kilde til sannhet.
 */

export const EMAIL_EVENT_KEYS = [
  "quoteSent",
  "invoiceSent",
  "paymentReceived",
  "bookingRequested",
  "bookingConfirmed",
  "bookingCancelled",
  "workOrderAssigned",
] as const;

export type EmailEventKey = (typeof EMAIL_EVENT_KEYS)[number];

/** Test-e-post er en egen mal, ikke en automatisk hendelse. */
export const EMAIL_TEST_TEMPLATE = "test";

export type EmailTemplateKey = EmailEventKey | typeof EMAIL_TEST_TEMPLATE;

export const EMAIL_EVENT_MODULES: Record<
  EmailEventKey,
  "quotes" | "invoicing" | "booking" | "core"
> = {
  quoteSent: "quotes",
  invoiceSent: "invoicing",
  paymentReceived: "invoicing",
  bookingRequested: "booking",
  bookingConfirmed: "booking",
  bookingCancelled: "booking",
  workOrderAssigned: "core",
};

export function isEmailEventKey(value: string): value is EmailEventKey {
  return (EMAIL_EVENT_KEYS as readonly string[]).includes(value);
}

/**
 * Feltverdiene som kan ligge i `EmailMessage.payload`. Alt rendres som tekst
 * og escapes, slik at en ondsinnet tittel aldri kan bli HTML.
 */
export type EmailTemplatePayload = {
  title?: string | null;
  customerName?: string | null;
  reference?: string | null;
  amount?: string | null;
  dueDate?: string | null;
  validUntil?: string | null;
  date?: string | null;
  time?: string | null;
  technicianName?: string | null;
  link?: string | null;
  note?: string | null;
};
