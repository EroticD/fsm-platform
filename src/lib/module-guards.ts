import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { internalApiError } from "@/lib/api-errors";
import { moduleEnabled } from "@/server/modules";
import type { ModuleKey } from "@/lib/modules";

/**
 * Direkte URL-er til en avslått modul skal gi 404, ikke en tom side eller en
 * 500. Sidene kaller denne før de gjør tunge spørringer.
 */
export async function requireModulePage(key: ModuleKey): Promise<void> {
  if (!(await moduleEnabled(key))) notFound();
}

/**
 * Samme vakt for rutehandlere som ikke bruker `authenticateApiRequest`.
 * Returnerer `null` når modulen er på, ellers en ferdig 404-respons.
 */
export async function moduleApiGuard(
  key: ModuleKey,
): Promise<NextResponse | null> {
  if (await moduleEnabled(key)) return null;
  return internalApiError("not_found", 404);
}
