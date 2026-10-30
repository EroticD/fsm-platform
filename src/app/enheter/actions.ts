"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { equipmentErrorParam } from "@/lib/equipment-feedback";
import {
  addMeterReading,
  createEquipment,
  deleteEquipment,
  moveEquipment,
  rotateEquipmentQrToken,
  updateEquipment,
} from "@/server/equipment";
import {
  createMaintenancePlan,
  updateMaintenancePlan,
} from "@/server/maintenance";

function detailHref(
  id: string,
  options: { meldt?: string; feil?: string; hash?: string } = {},
) {
  const params = new URLSearchParams();
  if (options.meldt) params.set("meldt", options.meldt);
  if (options.feil) params.set("feil", options.feil);
  const suffix = params.toString();
  return `/enheter/${id}${suffix ? `?${suffix}` : ""}${options.hash ?? ""}`;
}

function revalidateEquipment(id?: string, customerId?: string | null) {
  revalidatePath("/enheter");
  if (id) revalidatePath(`/enheter/${id}`);
  if (customerId) revalidatePath(`/kunder/${customerId}`);
  revalidatePath("/");
}

export async function createEquipmentAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createEquipment(actor, {
    customerId: formData.get("customerId"),
    model: formData.get("model"),
    serialNumber: formData.get("serialNumber"),
    location: formData.get("location"),
    categoryId: formData.get("categoryId"),
    parentId: formData.get("parentId"),
    installDate: formData.get("installDate"),
    warrantyUntil: formData.get("warrantyUntil"),
    status: formData.get("status"),
    criticality: formData.get("criticality"),
    meterUnit: formData.get("meterUnit"),
  });

  if (!result.ok) {
    redirect(`/enheter/ny?feil=${encodeURIComponent(equipmentErrorParam(result))}`);
  }

  revalidateEquipment(result.data.id, String(formData.get("customerId") ?? ""));
  redirect(detailHref(result.data.id, { meldt: "created" }));
}

export async function updateEquipmentAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const result = await updateEquipment(actor, {
    id,
    model: formData.get("model"),
    serialNumber: formData.get("serialNumber"),
    location: formData.get("location"),
    categoryId: formData.get("categoryId"),
    parentId: formData.get("parentId"),
    installDate: formData.get("installDate"),
    warrantyUntil: formData.get("warrantyUntil"),
    status: formData.get("status"),
    criticality: formData.get("criticality"),
    meterUnit: formData.get("meterUnit"),
  });

  if (!result.ok) {
    redirect(
      detailHref(id, { feil: equipmentErrorParam(result), hash: "#rediger" }),
    );
  }

  revalidateEquipment(id, customerId);
  redirect(detailHref(id, { meldt: "updated" }));
}

export async function moveEquipmentAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const result = await moveEquipment(
    actor,
    id,
    String(formData.get("parentId") ?? "") || null,
  );

  if (!result.ok) {
    redirect(
      detailHref(id, { feil: equipmentErrorParam(result), hash: "#hierarki" }),
    );
  }

  revalidateEquipment(id, customerId);
  redirect(detailHref(id, { meldt: "moved", hash: "#hierarki" }));
}

export async function rotateQrTokenAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const result = await rotateEquipmentQrToken(actor, id);

  if (!result.ok) {
    redirect(detailHref(id, { feil: equipmentErrorParam(result), hash: "#qr" }));
  }

  revalidateEquipment(id, customerId);
  redirect(detailHref(id, { meldt: "qr-rotated", hash: "#qr" }));
}

export async function addMeterReadingAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const result = await addMeterReading(actor, id, {
    value: formData.get("value"),
    readAt: formData.get("readAt"),
    source: formData.get("source"),
    note: formData.get("note"),
  });

  if (!result.ok) {
    redirect(
      detailHref(id, { feil: equipmentErrorParam(result), hash: "#maler" }),
    );
  }

  revalidateEquipment(id, customerId);
  redirect(detailHref(id, { meldt: "reading-added", hash: "#maler" }));
}

export async function createMaintenancePlanAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const result = await createMaintenancePlan(actor, {
    title: formData.get("title"),
    trigger: formData.get("trigger"),
    productId: id,
    customerId,
    intervalMonths: formData.get("intervalMonths"),
    meterInterval: formData.get("meterInterval"),
    leadDays: formData.get("leadDays"),
    nextDueDate: formData.get("nextDueDate"),
  });

  if (!result.ok) {
    redirect(
      detailHref(id, { feil: equipmentErrorParam(result), hash: "#planer" }),
    );
  }

  revalidateEquipment(id, customerId);
  redirect(detailHref(id, { meldt: "plan-created", hash: "#planer" }));
}

export async function toggleMaintenancePlanAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const planId = String(formData.get("planId") ?? "");
  const isActive = String(formData.get("isActive") ?? "") === "true";
  const result = await updateMaintenancePlan(actor, {
    id: planId,
    isActive: !isActive,
  });

  if (!result.ok) {
    redirect(
      detailHref(id, { feil: equipmentErrorParam(result), hash: "#planer" }),
    );
  }

  revalidateEquipment(id, customerId);
  redirect(detailHref(id, { meldt: "plan-updated", hash: "#planer" }));
}

export async function deleteEquipmentAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  const result = await deleteEquipment(actor, id);

  if (!result.ok) {
    redirect(detailHref(id, { feil: equipmentErrorParam(result) }));
  }

  revalidateEquipment(undefined, customerId);
  redirect(`/enheter?meldt=deleted`);
}
