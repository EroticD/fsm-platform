"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { eraseCustomerData } from "@/server/customer-erasure";

function redirectWith(
  id: string,
  key: "error" | "status",
  value: string,
): never {
  redirect(`/kunder/${id}/personvern?${key}=${value}`);
}

/** Anonymiserer kundens direkte identifikatorer. Bare administrator. */
export async function eraseCustomerDataAction(
  customerId: string,
  formData: FormData,
) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await eraseCustomerData(actor, customerId, {
    reason: formData.get("reason"),
    confirmation: formData.get("confirmation"),
  });

  if (!result.ok) {
    if (result.reason === "forbidden") redirectWith(customerId, "error", "forbudt");
    if (result.reason === "not_found") redirect("/kunder");
    if (result.reason === "conflict") {
      redirectWith(customerId, "error", "blokkert");
    }
    if (result.reason === "invalid") {
      redirectWith(customerId, "error", "ugyldig");
    }
    redirectWith(customerId, "error", "feil");
  }

  if (result.data.alreadyAnonymised) {
    redirectWith(customerId, "status", "allerede");
  }

  revalidatePath(`/kunder/${customerId}`);
  revalidatePath("/kunder");
  revalidatePath("/");
  revalidatePath("/oppdrag");
  revalidatePath("/mine-oppdrag");
  revalidatePath("/kalender");
  redirectWith(customerId, "status", "slettet");
}
