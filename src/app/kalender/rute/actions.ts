"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { applyRouteOrder, ROUTE_ERROR_CODES } from "@/server/route-plan";
import { setRouteSequences } from "@/server/manual-route";
import { moduleEnabled } from "@/server/modules";

const ROUTE_PATH = "/kalender/rute";

function readId(formData: FormData, key: string): string {
  return cleanText(formData.get(key), { maxLength: LIMITS.line });
}

function hrefWith(
  date: string,
  technicianId: string,
  extra: Record<string, string>,
): string {
  const params = new URLSearchParams();
  if (date) params.set("dato", date);
  if (technicianId) params.set("tekniker", technicianId);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  return `${ROUTE_PATH}?${params.toString()}`;
}

function firstErrorCode(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const code = (details as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/**
 * Viser optimaliseringsforslaget med før/etter-sammendrag. Ingenting flyttes
 * her; kontoret må fortsatt trykke «Bruk rekkefølge», som revisjonslogges.
 */
export async function optimizeRouteAction(formData: FormData): Promise<void> {
  if (!(await moduleEnabled("calendar"))) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const date = cleanText(formData.get("dato"), { maxLength: 10 });
  const technicianId = readId(formData, "tekniker");
  if (
    !hasPermission(user, "workorders.update") &&
    !hasPermission(user, "workorders.assign") &&
    !hasPermission(user, "dispatch.configure")
  ) {
    redirect(hrefWith(date, technicianId, { feil: ROUTE_ERROR_CODES.forbidden }));
  }
  if (!date) {
    redirect(hrefWith(date, technicianId, { feil: ROUTE_ERROR_CODES.invalid }));
  }

  redirect(hrefWith(date, technicianId, { optimaliser: "1" }));
}

/**
 * Lagrer manuell rekkefølge fra nummerfeltene i ruteplanleggeren.
 *
 * Nummerfeltene heter `sequence-<visitId>`. Visittene sorteres etter tallet,
 * deretter etter feltrekkefølgen. Rekkefølgen lagres først, og deretter
 * flyttes tidspunktene med samme tjenestelag som «Bruk rekkefølge». Hvis
 * flyttingen avvises, blir nummereringen likevel stående, slik at kontoret kan
 * rette konflikten uten å miste inntastingen.
 */
export async function saveManualOrderAction(formData: FormData): Promise<void> {
  if (!(await moduleEnabled("calendar"))) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const date = cleanText(formData.get("dato"), { maxLength: 10 });
  const technicianId = readId(formData, "tekniker");
  if (!hasPermission(user, "workorders.assign")) {
    redirect(hrefWith(date, technicianId, { feil: ROUTE_ERROR_CODES.forbidden }));
  }

  const items: Array<{ visitId: string; sequence: string; index: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("sequence-")) continue;
    const visitId = key.slice("sequence-".length);
    if (!visitId) continue;
    items.push({
      visitId,
      sequence: cleanText(value, { maxLength: 8 }),
      index: items.length,
    });
  }
  items.sort((a, b) => {
    const left = Number.parseInt(a.sequence, 10);
    const right = Number.parseInt(b.sequence, 10);
    const safeLeft = Number.isFinite(left) && left > 0 ? left : 9999;
    const safeRight = Number.isFinite(right) && right > 0 ? right : 9999;
    return safeLeft - safeRight || a.index - b.index;
  });

  if (!date || !technicianId || items.length === 0) {
    redirect(hrefWith(date, technicianId, { feil: ROUTE_ERROR_CODES.invalid }));
  }

  // Normaliser til 1..n etter den sorterte rekkefølgen. Da er nummereringen
  // entydig også hvis kontoret skrev samme tall på flere stopp.
  const normalized = items.map((item, index) => ({
    visitId: item.visitId,
    sequence: String(index + 1),
  }));

  const saved = await setRouteSequences(user, {
    date,
    technicianId,
    items: normalized,
  });
  if (!saved.ok) {
    redirect(
      hrefWith(date, technicianId, {
        feil: firstErrorCode(saved.details) ?? saved.reason,
      }),
    );
  }

  const result = await applyRouteOrder(user, {
    date,
    technicianId,
    visitIds: normalized.map((item) => item.visitId),
  });
  if (!result.ok) {
    revalidatePath(ROUTE_PATH);
    redirect(
      hrefWith(date, technicianId, {
        feil: firstErrorCode(result.details) ?? result.reason,
      }),
    );
  }

  revalidatePath(ROUTE_PATH);
  revalidatePath("/kalender/dispatch");
  redirect(hrefWith(date, technicianId, { manuelt: "1" }));
}

/**
 * Bruker den foreslåtte rekkefølgen. Rekkefølgen sendes som skjulte felt i
 * samme orden som ruten viste den, men tjenestelaget regner planen på nytt og
 * avviser hele endringen hvis noe er endret i mellomtiden.
 */
export async function applyRouteOrderAction(formData: FormData): Promise<void> {
  if (!(await moduleEnabled("calendar"))) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  const date = cleanText(formData.get("dato"), { maxLength: 10 });
  const technicianId = readId(formData, "tekniker");
  if (!hasPermission(user, "workorders.assign")) {
    redirect(hrefWith(date, technicianId, { feil: ROUTE_ERROR_CODES.forbidden }));
  }

  const visitIds = formData
    .getAll("visitId")
    .map((value) => cleanText(value, { maxLength: LIMITS.line }))
    .filter(Boolean);

  if (!date || !technicianId || visitIds.length === 0) {
    redirect(hrefWith(date, technicianId, { feil: ROUTE_ERROR_CODES.invalid }));
  }

  const result = await applyRouteOrder(user, {
    date,
    technicianId,
    visitIds,
  });

  if (!result.ok) {
    redirect(
      hrefWith(date, technicianId, {
        feil: firstErrorCode(result.details) ?? result.reason,
      }),
    );
  }

  revalidatePath(ROUTE_PATH);
  revalidatePath("/kalender/dispatch");
  redirect(
    hrefWith(date, technicianId, {
      anvendt: String(result.data.applied),
    }),
  );
}
