// i18n-ignore-file: nøkler, vinduer og fingre er tekniske data, ikke UI-tekst.
import { createHash } from "node:crypto";
import type { ExportOptions } from "./types";

/**
 * Hvor lenge en nylig eksport med samme bestilling kan gjenbrukes. Uten dette
 * ville et dobbeltklikk eller en automatisk retry telt som en ny eksport og
 * spist av rate-limit-budsjettet.
 */
export const EXPORT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

/**
 * En PENDING-jobb eldre enn dette regnes som forlatt (f.eks. etter en krasjet
 * prosess). Da lages en ny jobb i stedet for at brukeren venter på en død jobb.
 */
export const EXPORT_STALE_RUNNING_MS = 2 * 60 * 1000;

/** Hvor lenge en duplikatforespørsel venter på at en pågående jobb blir klar. */
export const EXPORT_DEDUPE_WAIT_MS = 20 * 1000;

/**
 * Ti starter i timen er nok for en administrator som rydder opp i flere
 * kundesett, men begrenser skade ved en løkke. Den gamle grensen på tre ble
 * brukt opp av tre feilede forsøk, slik at den egentlige feilen ble skjult bak
 * et 429-svar.
 */
export const EXPORT_RATE_LIMIT = {
  limit: 10,
  windowMs: 60 * 60 * 1000,
} as const;

export type ExportRequestInput = {
  customerIds: string[];
  includeFiles?: boolean;
  includeDeleted?: boolean;
  includeLegalHold?: boolean;
  includeAudit?: boolean;
  includeSignatures?: boolean;
};

/** Kanonisk bestilling: sorterte, unike kunde-id-er og normaliserte valg. */
export function normaliseExportOptions(input: ExportRequestInput): ExportOptions {
  return {
    customerIds: [...new Set(input.customerIds.filter(Boolean))].sort(),
    includeFiles: input.includeFiles ?? true,
    includeDeleted: input.includeDeleted ?? false,
    includeLegalHold: input.includeLegalHold ?? false,
    includeAudit: input.includeAudit ?? true,
    includeSignatures: input.includeSignatures ?? false,
  };
}

/**
 * Fingeravtrykk av kundesett + valg. Tidsstempler er bevisst utelatt, slik at
 * samme bestilling i dedupe-vinduet gir samme jobb. Versjonen kan økes dersom
 * semantikken i bestillingen endres.
 */
export function exportRequestFingerprint(options: ExportOptions): string {
  const canonical = JSON.stringify({
    // Versjon 2 tar med modulsnapshotet, slik at en eksport laget før en modul
    // ble slått av ikke gjenbrukes etterpå.
    version: 2,
    customerIds: [...options.customerIds].sort(),
    modules: [...(options.modules ?? [])].sort(),
    includeFiles: options.includeFiles,
    includeDeleted: options.includeDeleted,
    includeLegalHold: options.includeLegalHold,
    includeAudit: options.includeAudit,
    includeSignatures: options.includeSignatures,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Versjonert nøkkel. Gamle tellere fra den feilende eksporten (før idempotens
 * og 10 i timen) skal ikke blokkere første legitime forsøk etter oppgradering.
 */
export function exportRateLimitKey(actorId: string): string {
  return `customer-transfer-export:v2:${actorId}`;
}
