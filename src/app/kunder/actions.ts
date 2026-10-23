"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { createCustomer, updateCustomer } from "@/server/customers";

/** Registrerer en ny kunde. Tynn wrapper rundt kundetjenesten. */
export async function addCustomer(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await createCustomer(actor, {
    name: formData.get("name"),
    orgNumber: formData.get("orgNumber"),
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect("/kunder?error=ugyldig-data");
    }
    return;
  }

  revalidatePath("/kunder");
}

/** Lagrer endringene på kundekortet. */
export async function updateCustomerAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) return;

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
    if (result.reason === "invalid") {
      redirect(`/kunder/${customerId}/rediger?error=ugyldig-data`);
    }
    if (result.reason === "error") {
      redirect(`/kunder/${customerId}/rediger?error=ukjent`);
    }
    return;
  }

  revalidatePath(`/kunder/${customerId}`);
  revalidatePath("/kunder");
}
