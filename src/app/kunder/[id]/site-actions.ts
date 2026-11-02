"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  createCustomerSite,
  deleteCustomerSite,
  setPrimaryCustomerSite,
  updateCustomerSite,
} from "@/server/customer-sites";
import { customerErrorParam } from "../feedback";

function sitesHref(
  customerId: string,
  params: URLSearchParams = new URLSearchParams(),
) {
  const query = params.toString();
  return `/kunder/${customerId}?tab=mer${query ? `&${query}` : ""}#steder`;
}

function siteInput(formData: FormData) {
  return {
    name: formData.get("name"),
    address: formData.get("address"),
    postalCode: formData.get("postalCode"),
    city: formData.get("city"),
    isPrimary: formData.get("isPrimary"),
  };
}

export async function createSiteAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createCustomerSite(actor, customerId, siteInput(formData));
  if (!result.ok) {
    redirect(
      sitesHref(
        customerId,
        new URLSearchParams({ error: customerErrorParam(result.reason) }),
      ),
    );
  }

  revalidatePath(`/kunder/${customerId}`);
  redirect(sitesHref(customerId, new URLSearchParams({ status: "sted-lagt-til" })));
}

export async function updateSiteAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await updateCustomerSite(actor, customerId, {
    ...siteInput(formData),
    id: formData.get("id"),
  });
  if (!result.ok) {
    redirect(
      sitesHref(
        customerId,
        new URLSearchParams({ error: customerErrorParam(result.reason) }),
      ),
    );
  }

  revalidatePath(`/kunder/${customerId}`);
  redirect(
    sitesHref(customerId, new URLSearchParams({ status: "sted-oppdatert" })),
  );
}

export async function deleteSiteAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await deleteCustomerSite(actor, customerId, {
    id: formData.get("id"),
  });
  if (!result.ok) {
    redirect(
      sitesHref(
        customerId,
        new URLSearchParams({ error: customerErrorParam(result.reason) }),
      ),
    );
  }

  revalidatePath(`/kunder/${customerId}`);
  redirect(sitesHref(customerId, new URLSearchParams({ status: "sted-slettet" })));
}

export async function setPrimarySiteAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await setPrimaryCustomerSite(actor, customerId, {
    id: formData.get("id"),
  });
  if (!result.ok) {
    redirect(
      sitesHref(
        customerId,
        new URLSearchParams({ error: customerErrorParam(result.reason) }),
      ),
    );
  }

  revalidatePath(`/kunder/${customerId}`);
  redirect(
    sitesHref(customerId, new URLSearchParams({ status: "sted-primaert" })),
  );
}
