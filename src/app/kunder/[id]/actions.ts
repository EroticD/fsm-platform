"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  addContact,
  deleteContact,
  deleteCustomer,
  updateContact,
} from "@/server/customers";
import {
  addContractLine,
  createContract,
  deleteContract,
  deleteContractLine,
  pauseContract,
  renewContract,
  resumeContract,
  terminateContract,
  updateContract,
} from "@/server/contracts";
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
  revalidatePath("/avtaler");
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

  const lineScope = formData.get("lineScope");
  const lineProductId = formData.get("lineProductId");
  const result = await createContract(actor, customerId, {
    title: formData.get("title"),
    contractNumber: formData.get("contractNumber"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    intervalMonths: formData.get("intervalMonths"),
    departmentId: formData.get("departmentId"),
    contactId: formData.get("contactId"),
    templateId: formData.get("templateId"),
    slaPolicyId: formData.get("slaPolicyId"),
    priceListId: formData.get("priceListId"),
    status: formData.get("status"),
    renewalMode: formData.get("renewalMode"),
    noticeDays: formData.get("noticeDays"),
    indexationPercent: formData.get("indexationPercent"),
    lines:
      lineScope || lineProductId
        ? [
            {
              productId: lineProductId,
              scope: lineScope,
            },
          ]
        : [],
  });

  if (!result.ok) {
    redirect(
      `/kunder/${customerId}?tab=avtaler&error=${customerErrorParam(result.reason)}`,
    );
  }

  revalidateContracts(customerId);
  redirect(`/kunder/${customerId}?tab=avtaler&status=avtale-opprettet`);
}

export async function updateContractAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await updateContract(
    actor,
    String(formData.get("id") ?? ""),
    {
      title: formData.get("title"),
      contractNumber: formData.get("contractNumber"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      intervalMonths: formData.get("intervalMonths"),
      departmentId: formData.get("departmentId"),
      contactId: formData.get("contactId"),
      templateId: formData.get("templateId"),
      slaPolicyId: formData.get("slaPolicyId"),
      priceListId: formData.get("priceListId"),
      status: formData.get("status") || undefined,
      renewalMode: formData.get("renewalMode"),
      noticeDays: formData.get("noticeDays"),
      indexationPercent: formData.get("indexationPercent"),
    },
  );
  if (!result.ok) {
    redirect(
      `/kunder/${customerId}?tab=avtaler&error=${customerErrorParam(result.reason)}`,
    );
  }
  revalidateContracts(customerId);
  redirect(`/kunder/${customerId}?tab=avtaler&status=avtale-oppdatert`);
}

function contractLifecycleAction(
  customerId: string,
  contractId: string,
  action: "pause" | "resume" | "terminate" | "renew",
) {
  return async () => {
    const actor = await getCurrentUser();
    if (!actor) redirect("/api/auth/signin");

    const result =
      action === "pause"
        ? await pauseContract(actor, contractId)
        : action === "resume"
          ? await resumeContract(actor, contractId)
          : action === "terminate"
            ? await terminateContract(actor, contractId)
            : await renewContract(actor, contractId);

    if (!result.ok) {
      redirect(
        `/kunder/${customerId}?tab=avtaler&error=${customerErrorParam(result.reason)}`,
      );
    }
    revalidateContracts(customerId);
    const status =
      action === "pause"
        ? "avtale-pauset"
        : action === "resume"
          ? "avtale-gjenopptatt"
          : action === "terminate"
            ? "avtale-avsluttet"
            : "avtale-fornyet";
    redirect(`/kunder/${customerId}?tab=avtaler&status=${status}`);
  };
}

export async function pauseContractAction(customerId: string, formData: FormData) {
  return contractLifecycleAction(
    customerId,
    String(formData.get("id") ?? ""),
    "pause",
  )();
}

export async function resumeContractAction(customerId: string, formData: FormData) {
  return contractLifecycleAction(
    customerId,
    String(formData.get("id") ?? ""),
    "resume",
  )();
}

export async function terminateContractAction(
  customerId: string,
  formData: FormData,
) {
  return contractLifecycleAction(
    customerId,
    String(formData.get("id") ?? ""),
    "terminate",
  )();
}

export async function renewContractAction(customerId: string, formData: FormData) {
  return contractLifecycleAction(
    customerId,
    String(formData.get("id") ?? ""),
    "renew",
  )();
}

export async function addContractLineAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await addContractLine(actor, {
    contractId: formData.get("contractId"),
    productId: formData.get("productId"),
    scope: formData.get("scope"),
    visitsPerYear: formData.get("visitsPerYear"),
    responseMinutes: formData.get("responseMinutes"),
    resolutionMinutes: formData.get("resolutionMinutes"),
  });
  if (!result.ok) {
    redirect(
      `/kunder/${customerId}?tab=avtaler&error=${customerErrorParam(result.reason)}`,
    );
  }
  revalidateContracts(customerId);
  redirect(`/kunder/${customerId}?tab=avtaler&status=avtale-linje-lagt-til`);
}

export async function deleteContractLineAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await deleteContractLine(actor, {
    id: formData.get("id"),
    contractId: formData.get("contractId"),
  });
  if (!result.ok) {
    redirect(
      `/kunder/${customerId}?tab=avtaler&error=${customerErrorParam(result.reason)}`,
    );
  }
  revalidateContracts(customerId);
  redirect(`/kunder/${customerId}?tab=avtaler&status=avtale-linje-slettet`);
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
