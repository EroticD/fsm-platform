"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  deactivateSlaPolicy,
  saveSlaPolicy,
} from "@/server/sla";
import {
  deleteHoliday,
  saveBusinessHours,
  saveHoliday,
} from "@/server/business-hours";
import {
  addPriceListItem,
  createPriceList,
  deletePriceListItem,
} from "@/server/contracts";

function slaHref(params: Record<string, string>) {
  return `/innstillinger?${new URLSearchParams({
    tab: "sla",
    ...params,
  }).toString()}`;
}

function revalidateSla() {
  revalidatePath("/innstillinger");
  revalidatePath("/avtaler");
  revalidatePath("/oppdrag");
}

/** "08:00" → 480. Tom verdi betyr stengt (0). */
function parseTime(value: FormDataEntryValue | null): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export async function saveSlaPolicyAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await saveSlaPolicy(actor, {
    id: formData.get("id"),
    name: formData.get("name"),
    departmentId: formData.get("departmentId"),
    responseMinutes: formData.get("responseMinutes"),
    resolutionMinutes: formData.get("resolutionMinutes"),
    businessHoursOnly:
      formData.get("businessHoursOnly") === "on" ? "true" : "false",
    isActive: formData.get("isActive") === "on" ? "true" : "false",
  });
  if (!result.ok) {
    redirect(slaHref({ error: result.reason }));
  }
  revalidateSla();
  redirect(slaHref({ ok: "policy" }));
}

export async function deactivateSlaPolicyAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await deactivateSlaPolicy(
    actor,
    String(formData.get("id") ?? ""),
  );
  if (!result.ok) redirect(slaHref({ error: result.reason }));
  revalidateSla();
  redirect(slaHref({ ok: "policy-deactivated" }));
}

export async function saveBusinessHoursAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const departmentId = String(formData.get("departmentId") ?? "");
  const rows = Array.from({ length: 7 }, (_, weekday) => {
    const closed = formData.get(`closed-${weekday}`) === "on";
    return {
      weekday,
      openMinute: closed ? 0 : parseTime(formData.get(`open-${weekday}`)),
      closeMinute: closed ? 0 : parseTime(formData.get(`close-${weekday}`)),
    };
  });

  const result = await saveBusinessHours(actor, departmentId, rows);
  if (!result.ok) {
    redirect(
      slaHref({
        error: result.reason,
        department: departmentId,
      }),
    );
  }
  revalidateSla();
  redirect(
    slaHref({ ok: "hours", department: departmentId }),
  );
}

export async function saveHolidayAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await saveHoliday(actor, {
    date: formData.get("date"),
    name: formData.get("name"),
    departmentId: formData.get("departmentId"),
  });
  if (!result.ok) redirect(slaHref({ error: result.reason }));
  revalidateSla();
  redirect(slaHref({ ok: "holiday" }));
}

export async function deleteHolidayAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await deleteHoliday(
    actor,
    String(formData.get("id") ?? ""),
  );
  if (!result.ok) redirect(slaHref({ error: result.reason }));
  revalidateSla();
  redirect(slaHref({ ok: "holiday-deleted" }));
}

export async function createPriceListAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createPriceList(actor, {
    name: formData.get("name"),
  });
  if (!result.ok) redirect(slaHref({ error: result.reason }));
  revalidateSla();
  redirect(slaHref({ ok: "price-list" }));
}

export async function addPriceListItemAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await addPriceListItem(actor, {
    priceListId: formData.get("priceListId"),
    code: formData.get("code"),
    label: formData.get("label"),
    unit: formData.get("unit"),
    amount: formData.get("amount"),
  });
  if (!result.ok) redirect(slaHref({ error: result.reason }));
  revalidateSla();
  redirect(slaHref({ ok: "price-item" }));
}

export async function deletePriceListItemAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await deletePriceListItem(actor, {
    id: formData.get("id"),
    priceListId: formData.get("priceListId"),
  });
  if (!result.ok) redirect(slaHref({ error: result.reason }));
  revalidateSla();
  redirect(slaHref({ ok: "price-item-deleted" }));
}
