"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  resetAccountingSync,
  syncInvoiceToAccounting,
  testAccountingConnection,
  updateAccountingSettings,
} from "@/server/accounting";

function code(result: { ok: false; reason: string; details?: unknown }): string {
  const details = result.details as { code?: string } | undefined;
  return details?.code ?? result.reason;
}

export async function updateAccountingSettingsAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await updateAccountingSettings(user, {
    enabled: formData.get("enabled"),
  });
  if (!result.ok) {
    redirect(`/faktura/innstillinger?error=${encodeURIComponent(code(result))}`);
  }
  revalidatePath("/faktura/innstillinger");
  redirect("/faktura/innstillinger?accountingSaved=1");
}

export async function testAccountingConnectionAction() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await testAccountingConnection(user);
  if (!result.ok) {
    redirect(`/faktura/innstillinger?error=${encodeURIComponent(code(result))}`);
  }
  revalidatePath("/faktura/innstillinger");
  redirect(`/faktura/innstillinger?accountingTest=${result.data.ok ? "ok" : "failed"}`);
}

export async function syncInvoiceToAccountingAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const invoiceId = String(formData.get("id") ?? "");
  const result = await syncInvoiceToAccounting(user, invoiceId);
  if (!result.ok) {
    redirect(`/faktura/${encodeURIComponent(invoiceId)}?error=${encodeURIComponent(code(result))}`);
  }
  revalidatePath(`/faktura/${invoiceId}`);
  redirect(
    `/faktura/${encodeURIComponent(invoiceId)}?accounting=${result.data.alreadySynced ? "already" : result.data.status.toLowerCase()}`,
  );
}

export async function resetAccountingSyncAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const invoiceId = String(formData.get("id") ?? "");
  const result = await resetAccountingSync(user, invoiceId);
  if (!result.ok) {
    redirect(`/faktura/${encodeURIComponent(invoiceId)}?error=${encodeURIComponent(code(result))}`);
  }
  revalidatePath(`/faktura/${invoiceId}`);
  redirect(`/faktura/${encodeURIComponent(invoiceId)}?accounting=reset`);
}
