/**
 * Tolkning av skannede QR-/strekkoder.
 *
 * Feltappen gjenkjenner våre egne former først og bygger aldri en ekstern URL
 * av innholdet. En QR-kode kan inneholde en full URL til vår egen QR-etikett,
 * en relativ sti, en enhetstoken, en oppdragsreferanse eller et ordrenummer.
 * Alt annet som ikke er tomt eller for langt, behandles som en opak ekstern
 * kode. Den slås bare opp i registeret over kundens eksisterende QR-koder;
 * innholdet hentes eller følges aldri, og serveren autoriserer målet på nytt.
 */

import {
  EXTERNAL_QR_MAX_LENGTH,
  normalizeExternalQrValue,
} from "@/lib/equipment-qr";

export type ScannedCode =
  | { kind: "equipment-token"; token: string }
  | { kind: "equipment-id"; id: string }
  | { kind: "work-order-id"; id: string }
  | { kind: "work-order-reference"; reference: string }
  | { kind: "work-order-number"; number: string }
  | { kind: "external"; value: string }
  | { kind: "invalid"; reason: "empty" | "too-long" };

const MAX_CODE_LENGTH = EXTERNAL_QR_MAX_LENGTH;
const SAFE_ID = /^[A-Za-z0-9_-]{4,64}$/;
const EQUIPMENT_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const WORK_ORDER_REFERENCE = /^(?:O|B)-\d{6}-[A-Z0-9]{6,8}$/i;
const WORK_ORDER_NUMBER = /^\d{2,30}$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fromPathname(pathname: string): ScannedCode | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const [first, second, third] = segments;

  if (first === "enheter" && second === "qr" && third) {
    const token = safeDecode(third);
    return EQUIPMENT_TOKEN.test(token)
      ? { kind: "equipment-token", token }
      : null;
  }

  if (
    (first === "enheter" || first === "oppdrag" || first === "mine-oppdrag") &&
    second &&
    !["qr", "ny", "kunder", "offline"].includes(second)
  ) {
    const id = safeDecode(second);
    if (!SAFE_ID.test(id)) return null;
    return first === "enheter"
      ? { kind: "equipment-id", id }
      : { kind: "work-order-id", id };
  }

  return null;
}

/** Trim og fjern usynlige tegn fra manuell inntasting eller en skannet kode. */
export function normalizeScannedCode(raw: string): string {
  return normalizeExternalQrValue(raw);
}

export function parseScannedCode(raw: string): ScannedCode {
  const value = normalizeScannedCode(raw);
  if (!value) return { kind: "invalid", reason: "empty" };
  if (value.length > MAX_CODE_LENGTH) {
    return { kind: "invalid", reason: "too-long" };
  }

  // Full URL: egne kjente stier gjenkjennes. Alt annet blir en opak ekstern
  // kode; vi følger aldri verten, skjemaet eller en eventuell omdirigering.
  if (/^https?:\/\//i.test(value)) {
    try {
      const fromUrl = fromPathname(new URL(value).pathname);
      if (fromUrl) return fromUrl;
    } catch {
      // Ugyldig URL behandles fortsatt som en opak streng.
    }
    return { kind: "external", value };
  }

  if (value.startsWith("/")) {
    const fromPath = fromPathname(value);
    if (fromPath) return fromPath;
    return { kind: "external", value };
  }

  // Våre egne former sjekkes før den eksterne katalogen, slik at
  // oppdragsnumre og -referanser aldri skygges av en ekstern kode.
  if (WORK_ORDER_REFERENCE.test(value)) {
    return { kind: "work-order-reference", reference: value.toUpperCase() };
  }
  if (WORK_ORDER_NUMBER.test(value)) {
    return { kind: "work-order-number", number: value };
  }
  if (EQUIPMENT_TOKEN.test(value)) {
    return { kind: "equipment-token", token: value };
  }

  return { kind: "external", value };
}

/**
 * Kameraet kan gi samme kode mange ganger i sekundet. Vi ignorerer den samme
 * koden innenfor vinduet, men slipper en ny kode gjennom med en gang.
 */
export function isDuplicateScan(
  previous: { code: string; at: number } | null | undefined,
  code: string,
  now = Date.now(),
  windowMs = 2500,
): boolean {
  if (!previous) return false;
  return previous.code === code && now - previous.at <= windowMs;
}
