"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { safeRelativeTarget } from "@/lib/safe-redirect";
import { moduleEnabled } from "@/server/modules";
import {
  addPurchaseOrderLine,
  cancelPurchaseOrder,
  createPurchaseOrderFromSuggestions,
  createSupplier,
  orderPurchaseOrder,
  receivePurchaseOrder,
  removePurchaseOrderLine,
  updatePurchaseOrderDraft,
} from "@/server/purchasing";

/**
 * Tynne server actions for innkjøpsflatene. Autorisasjon, validering,
 * transaksjoner og revisjon ligger i `src/server/purchasing.ts`.
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

function revalidatePurchasing(orderId?: string) {
  revalidatePath("/lager");
  revalidatePath("/lager/innkjop");
  revalidatePath("/lager/innkjop/leverandorer");
  if (orderId) revalidatePath(`/lager/innkjop/${orderId}`);
}

export async function createSupplierAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createSupplier(actor, {
    name: formData.get("name"),
    orgNumber: formData.get("orgNumber"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    departmentId: formData.get("departmentId"),
  });
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        "/lager/innkjop/leverandorer",
      ),
    );
  }
  revalidatePurchasing();
  redirect("/lager/innkjop/leverandorer?meldt=created");
}

export async function createFromSuggestionsAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createPurchaseOrderFromSuggestions(actor, {
    supplierId: formData.get("supplierId"),
    locationId: formData.get("locationId"),
    itemIds: formData.getAll("itemId"),
    expectedAt: formData.get("expectedAt"),
    notes: formData.get("notes"),
  });
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        "/lager/innkjop",
      ),
    );
  }
  revalidatePurchasing(result.data.id);
  redirect(`/lager/innkjop/${result.data.id}?meldt=created`);
}

export async function updateDraftAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const result = await updatePurchaseOrderDraft(actor, {
    id,
    expectedAt: formData.get("expectedAt"),
    notes: formData.get("notes"),
  });
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        `/lager/innkjop/${id}`,
      ),
    );
  }
  revalidatePurchasing(id);
  redirect(`/lager/innkjop/${id}?meldt=updated`);
}

export async function addLineAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const orderId = String(formData.get("purchaseOrderId") ?? "");
  const result = await addPurchaseOrderLine(actor, {
    purchaseOrderId: orderId,
    itemId: formData.get("itemId"),
    orderedQuantity: formData.get("orderedQuantity"),
    unitCost: formData.get("unitCost"),
  });
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        `/lager/innkjop/${orderId}`,
      ),
    );
  }
  revalidatePurchasing(orderId);
  redirect(`/lager/innkjop/${orderId}?meldt=line-added`);
}

export async function removeLineAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const orderId = String(formData.get("purchaseOrderId") ?? "");
  const result = await removePurchaseOrderLine(actor, {
    purchaseOrderId: orderId,
    lineId: formData.get("lineId"),
  });
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        `/lager/innkjop/${orderId}`,
      ),
    );
  }
  revalidatePurchasing(orderId);
  redirect(`/lager/innkjop/${orderId}?meldt=line-removed`);
}

export async function orderPurchaseOrderAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const orderId = String(formData.get("purchaseOrderId") ?? "");
  const result = await orderPurchaseOrder(actor, orderId);
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        `/lager/innkjop/${orderId}`,
      ),
    );
  }
  revalidatePurchasing(orderId);
  redirect(`/lager/innkjop/${orderId}?meldt=ordered`);
}

export async function cancelPurchaseOrderAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const orderId = String(formData.get("purchaseOrderId") ?? "");
  const result = await cancelPurchaseOrder(actor, orderId);
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        `/lager/innkjop/${orderId}`,
      ),
    );
  }
  revalidatePurchasing(orderId);
  redirect(`/lager/innkjop/${orderId}?meldt=cancelled`);
}

export async function receivePurchaseOrderAction(formData: FormData) {
  if (!(await moduleEnabled("inventory"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const orderId = String(formData.get("purchaseOrderId") ?? "");
  const receipts: Array<{ lineId: string; quantity: FormDataEntryValue }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("quantity:")) continue;
    const lineId = key.slice("quantity:".length);
    if (!lineId) continue;
    receipts.push({ lineId, quantity: value });
  }

  const result = await receivePurchaseOrder(actor, orderId, receipts);
  if (!result.ok) {
    redirect(
      backWith(
        formData,
        "feil",
        detailsCode(result) || result.reason,
        `/lager/innkjop/${orderId}`,
      ),
    );
  }
  revalidatePurchasing(orderId);
  redirect(`/lager/innkjop/${orderId}?meldt=received`);
}
