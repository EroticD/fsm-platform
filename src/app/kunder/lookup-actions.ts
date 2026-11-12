"use server";

/**
 * Oppslag mot Enhetsregisteret og adresseregisteret mens brukeren fyller ut
 * kundeskjemaet.
 *
 * Dette er AJAX-kall, ikke skjemainnsendinger: alle avvisninger returneres som
 * en status i stedet for en redirect, slik at skjemaet beholder feltene
 * brukeren allerede har skrevet. Typene har ingen `forbidden`, så et avvist
 * kall svarer `unavailable` – klienten skal uansett ikke skille «ikke lov» fra
 * «tjenesten svarer ikke».
 *
 * Organisasjonsnummer-oppslaget bor i `./actions.ts` og dupliseres ikke her.
 */

import { auditStandalone } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { allowRequestMemory } from "@/lib/rate-limit-memory";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { getCurrentUser } from "@/lib/session";
import {
  listSubUnits,
  searchCompaniesByName,
  type CompanySearch,
  type SubUnitList,
} from "@/lib/brreg";
import { searchAddresses, type AddressSearch } from "@/lib/address-search";
import { toAuditActor, type ServiceActor } from "@/server/actor";

/**
 * Felles vern for alle tre oppslagene: innlogget bruker, `customers.manage` og
 * en kvote per bruker og funksjon.
 *
 * Hvert kall går mot et eksternt register. Grensen ligger per bruker, slik at
 * én fane med raske tastetrykk ikke kan bruke opp kvoten for alle. `bucket` er
 * funksjonsnavnet; bruker-id-en legges på her, så kallstedet ikke kan glemme
 * den og dermed dele kvote på tvers av brukere.
 */
async function authorize(
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<ServiceActor | null> {
  const actor = await getCurrentUser();
  if (!actor) return null;
  if (!hasPermission(actor, "customers.manage")) return null;
  if (!allowRequestMemory(`${bucket}:${actor.id}`, limit, windowMs).allowed) {
    return null;
  }
  return actor;
}

/**
 * Skriver oppslaget til den hash-kjedede revisjonsloggen.
 *
 * Oppslaget endrer ingen forretningsdata, men det skal likevel være sporbart
 * hvem som har slått opp hva. Revisjonsfeil får ikke velte svaret til brukeren.
 * `action` er en stabil teknisk kode, ikke visningstekst.
 */
async function auditLookup(
  actor: ServiceActor,
  entityId: string,
  kind: "name_search" | "subunits",
  status: string,
  hits: number,
): Promise<void> {
  try {
    await auditStandalone({
      entityType: "Customer",
      entityId,
      action: "customer.lookup",
      actionCode: "customer.lookup",
      actor: toAuditActor(actor),
      metadata: { kind, status, hits },
      retentionClass: "OPS_90D",
    });
  } catch (error) {
    console.error("Feil ved revisjon av registeroppslag:", error);
  }
}

/** Søker etter firmaer på navn. Kalles mens brukeren skriver. */
export async function searchCompanyByNameAction(
  query: string,
): Promise<CompanySearch> {
  const actor = await authorize("brreg-search", 30, 60_000);
  if (!actor) return { status: "unavailable" };

  const input = cleanText(query, { maxLength: LIMITS.line });
  const result = await searchCompaniesByName(input);

  await auditLookup(
    actor,
    `sok:${input}`,
    "name_search",
    result.status,
    result.status === "ok" ? result.companies.length : 0,
  );

  return result;
}

/** Lister underenhetene til en hovedenhet brukeren har valgt. */
export async function listSubUnitsAction(
  orgNumber: string,
): Promise<SubUnitList> {
  const actor = await authorize("brreg-units", 30, 60_000);
  if (!actor) return { status: "unavailable" };

  const input = cleanText(orgNumber, { maxLength: LIMITS.line });
  const result = await listSubUnits(input);

  await auditLookup(
    actor,
    `orgnr:${input}`,
    "subunits",
    result.status,
    result.status === "ok" ? result.units.length : 0,
  );

  return result;
}

/**
 * Slår opp adresser til adressefeltet i kundeskjemaet.
 *
 * Adressesøket logges ikke: det er inndata brukeren skriver, ikke kundedata,
 * og feltet fylles ut før kunden finnes.
 */
export async function searchAddressAction(
  query: string,
  postalCode?: string,
): Promise<AddressSearch> {
  const actor = await authorize("address-search", 60, 60_000);
  if (!actor) return { status: "unavailable" };

  const input = cleanText(query, { maxLength: LIMITS.line });
  const postal = postalCode
    ? cleanText(postalCode, { maxLength: 20 })
    : undefined;
  return searchAddresses(input, undefined, { postalCode: postal });
}
