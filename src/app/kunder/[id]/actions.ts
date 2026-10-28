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
import { customerErrorParam } from "../feedback";

/** Myksletter kunden fra kundekortet. Bare administrator. */
export async function deleteCustomerAction(customerId: string) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await deleteCustomer(actor, customerId);
  if (!result.ok) {
    redirect(`/kunder/${customerId}?error=${customerErrorParam(result.reason)}`);
  }

  revalidatePath("/kunder");
  revalidatePath("/");
  redirect("/kunder?status=kunde-slettet");
}

function revalidateContracts(customerId: string) {
  revalidatePath(`/kunder/${customerId}`);
  revalidatePath("/kalender");
  revalidatePath("/oppdrag");
  revalidatePath("/mine-oppdrag");
  revalidatePath("/");
}

function contactHref(customerId: string, params: URLSearchParams) {
  return `/kunder/${customerId}?tab=mer&${params.toString()}#kontakter`;
}

// --- KONTAKTPERSONER ---

export async function addContactAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await addContact(actor, customerId, {
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    role: formData.get("role"),
  });

  if (!result.ok) {
    redirect(
      contactHref(
        customerId,
        new URLSearchParams({ error: customerErrorParam(result.reason) }),
      ),
    );
  }

  revalidatePath(`/kunder/${customerId}`);
  redirect(contactHref(customerId, new URLSearchParams({ status: "kontakt-lagt-til" })));
}

export async function updateContactAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await updateContact(actor, customerId, {
    id: formData.get("id"),
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    role: formData.get("role"),
  });

  if (!result.ok) {
    redirect(
      contactHref(
        customerId,
        new URLSearchParams({ error: customerErrorParam(result.reason) }),
      ),
    );
  }

  revalidatePath(`/kunder/${customerId}`);
  redirect(contactHref(customerId, new URLSearchParams({ status: "kontakt-oppdatert" })));
}

export async function deleteContactAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await deleteContact(actor, customerId, {
    id: formData.get("id"),
  });
  if (!result.ok) {
    redirect(
      contactHref(
        customerId,
        new URLSearchParams({ error: customerErrorParam(result.reason) }),
      ),
    );
  }

  revalidatePath(`/kunder/${customerId}`);
  redirect(contactHref(customerId, new URLSearchParams({ status: "kontakt-slettet" })));
}

// --- SERVICEAVTALER ---

export async function createContractAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createContract(actor, customerId, {
    title: formData.get("title"),
    startDate: formData.get("startDate"),
    intervalMonths: formData.get("intervalMonths"),
    departmentId: formData.get("departmentId"),
    contactId: formData.get("contactId"),
    templateId: formData.get("templateId"),
  });

  if (!result.ok) {
    redirect(
      `/kunder/${customerId}?tab=avtaler&error=${customerErrorParam(result.reason)}`,
    );
  }

  revalidateContracts(customerId);
  redirect(`/kunder/${customerId}?tab=avtaler&status=avtale-opprettet`);
}

export async function toggleContractAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const active = formData.get("active") === "true";
  const result = await toggleContract(actor, customerId, {
    id: formData.get("id"),
    active: formData.get("active"),
  });

  if (!result.ok) {
    redirect(
      `/kunder/${customerId}?tab=avtaler&error=${customerErrorParam(result.reason)}`,
    );
  }

  revalidateContracts(customerId);
  redirect(
    `/kunder/${customerId}?tab=avtaler&status=${
      active ? "avtale-aktivert" : "avtale-pauset"
    }`,
  );
}

export async function deleteContractAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await deleteContract(actor, customerId, {
    id: formData.get("id"),
  });
  if (!result.ok) {
    redirect(
      `/kunder/${customerId}?tab=avtaler&error=${customerErrorParam(result.reason)}`,
    );
  }

  revalidatePath(`/kunder/${customerId}`);
  revalidatePath("/kalender");
  redirect(`/kunder/${customerId}?tab=avtaler&status=avtale-slettet`);
}
