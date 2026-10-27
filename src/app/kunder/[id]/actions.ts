"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  addContact,
  createContract,
  deleteContact,
  deleteContract,
  deleteCustomer,
  toggleContract,
  updateContact,
} from "@/server/customers";

/** Myksletter kunden fra kundekortet. Bare administrator. */
export async function deleteCustomerAction(customerId: string) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await deleteCustomer(actor, customerId);
  if (!result.ok) return;

  revalidatePath("/kunder");
  revalidatePath("/");
  redirect("/kunder");
}

function revalidateContracts(customerId: string) {
  revalidatePath(`/kunder/${customerId}`);
  revalidatePath("/kalender");
  revalidatePath("/oppdrag");
  revalidatePath("/mine-oppdrag");
  revalidatePath("/");
}

// --- KONTAKTPERSONER ---

export async function addContactAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await addContact(actor, customerId, {
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    role: formData.get("role"),
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(`/kunder/${customerId}?tab=kontakter&error=ugyldig-data`);
    }
    return;
  }

  revalidatePath(`/kunder/${customerId}`);
}

export async function updateContactAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await updateContact(actor, customerId, {
    id: formData.get("id"),
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    role: formData.get("role"),
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(`/kunder/${customerId}?tab=kontakter&error=ugyldig-data`);
    }
    return;
  }

  revalidatePath(`/kunder/${customerId}`);
}

export async function deleteContactAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) return;

  await deleteContact(actor, customerId, { id: formData.get("id") });
  revalidatePath(`/kunder/${customerId}`);
}

// --- SERVICEAVTALER ---

export async function createContractAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await createContract(actor, customerId, {
    title: formData.get("title"),
    startDate: formData.get("startDate"),
    intervalMonths: formData.get("intervalMonths"),
    departmentId: formData.get("departmentId"),
    contactId: formData.get("contactId"),
    templateId: formData.get("templateId"),
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(`/kunder/${customerId}?tab=avtaler&error=ugyldig-data`);
    }
    return;
  }

  revalidateContracts(customerId);
}

export async function toggleContractAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await toggleContract(actor, customerId, {
    id: formData.get("id"),
    active: formData.get("active"),
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(`/kunder/${customerId}?tab=avtaler&error=ugyldig-data`);
    }
    return;
  }

  revalidateContracts(customerId);
}

export async function deleteContractAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) return;

  const result = await deleteContract(actor, customerId, {
    id: formData.get("id"),
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      redirect(`/kunder/${customerId}?tab=avtaler&error=ugyldig-data`);
    }
    return;
  }

  revalidatePath(`/kunder/${customerId}`);
  revalidatePath("/kalender");
}
