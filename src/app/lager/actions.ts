"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { safeRelativeTarget } from "@/lib/safe-redirect";
import { moduleEnabled } from "@/server/modules";
import {
  adjustStock,
  consumeReservation,
  consumeReservationsForVisit,
  createInventoryItem,
  createInventoryLocation,
  releaseReservation,
  reserveStock,
  updateInventoryItem,
  updateInventoryLocation,
} from "@/server/inventory";

/**
 * Tynne server actions for lagerflatene. All validering, autorisasjon og
 * revisjon ligger i `src/server/inventory.ts`.
 */

function detailsCode(result: { details?: unknown }): string {
  const details = result.details;
  if (details && typeof details === "object" && "code" in details) {
    const code = (details as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

function backWith(
  formData: FormData,
  key: "meldt" | "feil",
  value: string,
  fallback: string,
): string {
  const path = safeRelativeTarget(String(formData.get("returnTo") ?? fallback));
  const url = new URL(path, "http://local.invalid");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

function revalidateInventory(itemId?: string, locationId?: string, workOrderId?: string) {
  revalidatePath("/lager");
  if (itemId) revalidatePath(`/lager/varer/${itemId}`);
  if (locationId) revalidatePath(`/lager/lokasjoner/${locationId}`);
  if (workOrderId) {
    revalidatePath(`/lager/oppdrag/${workOrderId}`);
    revalidatePath(`/oppdrag/${workOrderId}`);
  }
}

export async function createInventoryItemAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createInventoryItem(actor, {
    sku: formData.get("sku"),
    name: formData.get("name"),
    unit: formData.get("unit"),
    minLevel: formData.get("minLevel"),
    description: formData.get("description"),
  });
  if (!result.ok) {
    redirect(backWith(formData, "feil", detailsCode(result) || result.reason, "/lager"));
  }
  revalidateInventory(result.data.id);
  redirect(`/lager/varer/${result.data.id}?meldt=created`);
}

export async function updateInventoryItemAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const result = await updateInventoryItem(actor, {
    id,
    sku: formData.get("sku"),
    name: formData.get("name"),
    unit: formData.get("unit"),
    minLevel: formData.get("minLevel"),
    description: formData.get("description"),
    active: formData.get("active") === null ? "false" : "true",
  });
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        `/lager/varer/${id}`,
      ),
    );
  }
  revalidateInventory(id);
  redirect(`/lager/varer/${id}?meldt=updated`);
}

export async function createInventoryLocationAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createInventoryLocation(actor, {
    name: formData.get("name"),
    type: formData.get("type"),
    departmentId: formData.get("departmentId"),
    assignedUserId: formData.get("assignedUserId"),
  });
  if (!result.ok) {
    redirect(backWith(formData, "feil", detailsCode(result) || result.reason, "/lager"));
  }
  revalidateInventory(undefined, result.data.id);
  redirect(`/lager/lokasjoner/${result.data.id}?meldt=created`);
}

export async function updateInventoryLocationAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const result = await updateInventoryLocation(actor, {
    id,
    name: formData.get("name"),
    isActive: formData.get("isActive") === null ? "false" : "true",
  });
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        `/lager/lokasjoner/${id}`,
      ),
    );
  }
  revalidateInventory(undefined, id);
  redirect(`/lager/lokasjoner/${id}?meldt=updated`);
}

export async function adjustStockAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const itemId = String(formData.get("itemId") ?? "");
  const locationId = String(formData.get("locationId") ?? "");
  const result = await adjustStock(actor, {
    itemId,
    locationId,
    type: formData.get("type"),
    quantity: formData.get("quantity"),
    reason: formData.get("reason"),
    workOrderId: formData.get("workOrderId"),
    visitId: formData.get("visitId"),
  });
  if (!result.ok) {
    redirect(
      backWith(formData, "feil", detailsCode(result) || result.reason, `/lager/varer/${itemId}`),
    );
  }
  revalidateInventory(itemId, locationId);
  redirect(
    backWith(
      formData,
      "meldt",
      `adjusted-${result.data.quantity}`,
      `/lager/varer/${itemId}`,
    ),
  );
}

export async function reserveStockAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const itemId = String(formData.get("itemId") ?? "");
  const locationId = String(formData.get("locationId") ?? "");
  const workOrderId = String(formData.get("workOrderId") ?? "");
  const result = await reserveStock(actor, {
    itemId,
    locationId,
    quantity: formData.get("quantity"),
    workOrderId,
    visitId: formData.get("visitId"),
    note: formData.get("note"),
  });
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        workOrderId ? `/lager/oppdrag/${workOrderId}` : `/lager/varer/${itemId}`,
      ),
    );
  }
  revalidateInventory(itemId, locationId, workOrderId);
  redirect(
    backWith(
      formData,
      "meldt",
      "reserved",
      workOrderId ? `/lager/oppdrag/${workOrderId}` : `/lager/varer/${itemId}`,
    ),
  );
}

export async function releaseReservationAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("reservationId") ?? "");
  const workOrderId = String(formData.get("workOrderId") ?? "");
  const result = await releaseReservation(actor, id);
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        workOrderId ? `/lager/oppdrag/${workOrderId}` : "/lager",
      ),
    );
  }
  revalidateInventory(undefined, undefined, workOrderId);
  redirect(
    backWith(
      formData,
      "meldt",
      "released",
      workOrderId ? `/lager/oppdrag/${workOrderId}` : "/lager",
    ),
  );
}

export async function consumeReservationAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("reservationId") ?? "");
  const workOrderId = String(formData.get("workOrderId") ?? "");
  const result = await consumeReservation(actor, id);
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        workOrderId ? `/lager/oppdrag/${workOrderId}` : "/lager",
      ),
    );
  }
  revalidateInventory(undefined, undefined, workOrderId);
  redirect(
    backWith(
      formData,
      "meldt",
      "consumed",
      workOrderId ? `/lager/oppdrag/${workOrderId}` : "/lager",
    ),
  );
}

export async function consumeVisitReservationsAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const visitId = String(formData.get("visitId") ?? "");
  const workOrderId = String(formData.get("workOrderId") ?? "");
  const result = await consumeReservationsForVisit(actor, visitId);
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        workOrderId ? `/lager/oppdrag/${workOrderId}` : "/lager",
      ),
    );
  }
  revalidateInventory(undefined, undefined, workOrderId);
  redirect(
    backWith(
      formData,
      "meldt",
      `visited-${result.data.consumed}`,
      workOrderId ? `/lager/oppdrag/${workOrderId}` : "/lager",
    ),
  );
}
