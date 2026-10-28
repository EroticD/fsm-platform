"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  createCustomer,
  deleteCustomer,
  restoreCustomer,
  updateCustomer,
} from "@/server/customers";
import { customerErrorParam } from "./feedback";

/** Registrerer en ny kunde. Tynn wrapper rundt kundetjenesten. */
export async function addCustomer(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createCustomer(actor, {
    name: formData.get("name"),
    orgNumber: formData.get("orgNumber"),
  });

  if (!result.ok) {
    redirect(`/kunder?error=${customerErrorParam(result.reason)}`);
  }

  revalidatePath("/kunder");
  redirect(`/kunder/${result.data.id}?status=kunde-opprettet`);
}

/** Lagrer endringene på kundekortet. */
export async function updateCustomerAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await updateCustomer(actor, customerId, {
    name: formData.get("name"),
    customerNumber: formData.get("customerNumber"),
    orgNumber: formData.get("orgNumber"),
    brandColor: formData.get("brandColor"),
    address: formData.get("address"),
    postalCode: formData.get("postalCode"),
    city: formData.get("city"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    notes: formData.get("notes"),
    departmentId: formData.get("departmentId"),
    responsibleTechnicianId: formData.get("responsibleTechnicianId"),
  });

  if (!result.ok) {
    redirect(
      `/kunder/${customerId}/rediger?error=${customerErrorParam(result.reason)}`,
    );
  }

  revalidatePath(`/kunder/${customerId}`);
  revalidatePath("/kunder");
  redirect(`/kunder/${customerId}?status=kunde-oppdatert`);
}

/** Myksletter en kunde. Bare administrator kommer gjennom i tjenesten. */
export async function deleteCustomerAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const result = await deleteCustomer(actor, id);
  if (!result.ok) {
    redirect(`/kunder?error=${customerErrorParam(result.reason)}`);
  }

  revalidatePath("/kunder");
  revalidatePath("/");
  redirect("/kunder?status=kunde-slettet");
}

/** Gjenoppretter en mykt slettet kunde. Bare administrator. */
export async function restoreCustomerAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const id = String(formData.get("id") ?? "");
  const result = await restoreCustomer(actor, id);
  if (!result.ok) {
    redirect(
      `/kunder?slettet=1&error=${customerErrorParam(result.reason)}`,
    );
  }

  revalidatePath("/kunder");
  redirect("/kunder?slettet=1&status=kunde-gjenopprettet");
}
