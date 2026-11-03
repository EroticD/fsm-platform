import { createHash, randomBytes } from "node:crypto";
import { dateOnlyInOslo } from "@/lib/dates";

/**
 * Menneskelig referanse for et oppdrag.
 *
 * Kontoret og montørene skal kunne lese referansen høyt for kunden og søke
 * den opp uten å kjenne den interne id-en. Formatet er `O-YYMMDD-XXXXXXXX`,
 * der datoen er opprettelsesdatoen i Europe/Oslo og suffikset er åtte tilfeldige
 * tegn. Kundeportalen bruker fortsatt `B-YYMMDD-XXXXXX` fra bestillingen; den
 * referansen kopieres til oppdraget slik at kunden og kontoret ser samme verdi.
 */
const REFERENCE_SUFFIX_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const REFERENCE_SUFFIX_LENGTH = 8;

/** Dato-delen `YYMMDD` i Europe/Oslo. */
export function workOrderReferenceDatePart(now = new Date()): string {
  return dateOnlyInOslo(now).slice(2).replace(/-/g, "");
}

/**
 * Deterministisk referanse for en eksisterende rad. Brukes av backfillen, der
 * vi ikke vil trekke tilfeldige verdier som er vanskelige å gjenskape.
 */
export function workOrderReferenceFromId(
  id: string,
  createdAt: Date | string,
): string {
  const created = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  const datePart = workOrderReferenceDatePart(created);
  const suffix = createHash("md5").update(id).digest("hex").slice(0, 8).toUpperCase();
  return `O-${datePart}-${suffix}`;
}

/** Ny tilfeldig referanse for et ordinært oppdrag. */
export function generateWorkOrderReference(
  now = new Date(),
  random: (size: number) => Buffer = randomBytes,
): string {
  const bytes = random(REFERENCE_SUFFIX_LENGTH);
  let suffix = "";
  for (let index = 0; index < REFERENCE_SUFFIX_LENGTH; index += 1) {
    suffix += REFERENCE_SUFFIX_ALPHABET[bytes[index] % REFERENCE_SUFFIX_ALPHABET.length];
  }
  return `O-${workOrderReferenceDatePart(now)}-${suffix}`;
}

/**
 * Kort bestillingsreferanse kunden kan oppgi til kontoret. Beholdes uendret
 * for eksisterende bestillinger; nye oppdrag kopierer den til
 * `WorkOrder.reference`.
 */
export function bookingReferenceForWorkOrder(
  workOrderId: string,
  now = new Date(),
): string {
  return `B-${workOrderReferenceDatePart(now)}-${workOrderId.slice(-6).toUpperCase()}`;
}

/** Er verdien på det formatet søket og UI-et forventer? */
export function isWorkOrderReference(value: string | null | undefined): boolean {
  return /^(?:B|O)-\d{6}-[A-Z0-9]{6,8}$/.test(value ?? "");
}
