import { parseSearchFilters, type SearchFilters } from "@/lib/search-filters";
import { parsePageNumber } from "./search-params";

/**
 * Leser et lagret søk fra skjemaet.
 *
 * Ligger utenfor `actions.ts` fordi en «use server»-modul bare kan eksportere
 * asynkrone server actions. Samme allowlist som URL-en brukes, så et manipulert
 * skjema kan ikke utvide søket eller tilgangen.
 */

function singleValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

export function searchFiltersFromFormData(formData: FormData): SearchFilters {
  return parseSearchFilters({
    types: formData.getAll("types").map((value) => String(value)),
    status: singleValue(formData, "status"),
    customer: singleValue(formData, "customer"),
    technician: singleValue(formData, "technician"),
    dateFrom: singleValue(formData, "dateFrom"),
    dateTo: singleValue(formData, "dateTo"),
    tag: singleValue(formData, "tag"),
    hmsType: singleValue(formData, "hmsType"),
  });
}

export function queryFromFormData(formData: FormData): string {
  return String(formData.get("q") ?? "").trim().slice(0, 100);
}

export function pageFromFormData(formData: FormData): number {
  return parsePageNumber(singleValue(formData, "page"));
}
