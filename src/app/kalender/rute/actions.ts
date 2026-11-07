"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { applyRouteOrder, ROUTE_ERROR_CODES } from "@/server/route-plan";
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
