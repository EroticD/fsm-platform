"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import {
  createInvoice,
  markOverdueInvoices,
  registerCreditNote,
  registerPayment,
  sendInvoice,
  updateBillingSettings,
  updateInvoice,
  type InvoiceInput,
} from "@/server/invoices";

function linesFrom(formData: FormData): unknown {
  const raw = formData.get("lines");
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Tomme rader fra skjemaet skal ikke blokkere «kopier linjer fra tilbud».
    return parsed.filter((line) => {
      if (!line || typeof line !== "object") return false;
      const row = line as Record<string, unknown>;
      return String(row.description ?? "").trim() !== "" || String(row.unitPrice ?? "").trim() !== "";
    });
  } catch {
    return [];
  }
}

function inputFrom(formData: FormData): InvoiceInput {
  return {
    customerId: formData.get("customerId"),
    contactId: formData.get("contactId"),
    workOrderId: formData.get("workOrderId"),
    reportId: formData.get("reportId"),
    quoteId: formData.get("quoteId"),
    departmentId: formData.get("departmentId"),
    issueDate: formData.get("issueDate"),
    dueDate: formData.get("dueDate"),
    notes: formData.get("notes"),
    vatRate: formData.get("vatRate"),
    lines: linesFrom(formData),
  };
}

function resultCode(result: { ok: false; reason: string; details?: unknown }): string {
  const details = result.details as { code?: string } | undefined;
  return details?.code ?? result.reason;
}

export async function createInvoiceAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await createInvoice(user, inputFrom(formData));
  if (!result.ok) {
    redirect(`/faktura/ny?error=${encodeURIComponent(resultCode(result))}`);
  }
  revalidatePath("/faktura");
  redirect(`/faktura/${result.data.id}`);
}

export async function updateInvoiceAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const invoiceId = String(formData.get("id") ?? "");
  const result = await updateInvoice(user, invoiceId, inputFrom(formData));
  if (!result.ok) {
    redirect(
      `/faktura/${encodeURIComponent(invoiceId)}/rediger?error=${encodeURIComponent(resultCode(result))}`,
    );
  }
  revalidatePath(`/faktura/${invoiceId}`);
  redirect(`/faktura/${result.data.id}`);
}

export async function sendInvoiceAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const invoiceId = String(formData.get("id") ?? "");
  const result = await sendInvoice(user, invoiceId);
  if (!result.ok) {
    redirect(`/faktura/${encodeURIComponent(invoiceId)}?error=${encodeURIComponent(resultCode(result))}`);
  }
  revalidatePath("/faktura");
  revalidatePath(`/faktura/${invoiceId}`);
  redirect(`/faktura/${encodeURIComponent(invoiceId)}?sent=1`);
}

export async function registerPaymentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const invoiceId = String(formData.get("id") ?? "");
  const result = await registerPayment(user, invoiceId, {
    amount: formData.get("amount"),
    paidAt: formData.get("paidAt"),
    method: formData.get("method"),
    reference: formData.get("reference"),
    note: formData.get("note"),
    idempotencyKey: formData.get("idempotencyKey") || randomUUID(),
  });
  if (!result.ok) {
    redirect(`/faktura/${encodeURIComponent(invoiceId)}?error=${encodeURIComponent(resultCode(result))}`);
  }
  revalidatePath("/faktura");
  revalidatePath(`/faktura/${invoiceId}`);
  redirect(
    `/faktura/${encodeURIComponent(invoiceId)}?payment=${result.data.duplicate ? "duplicate" : "ok"}`,
  );
}

export async function registerCreditNoteAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const invoiceId = String(formData.get("id") ?? "");
  const result = await registerCreditNote(user, invoiceId, {
    amount: formData.get("amount"),
    reason: formData.get("reason"),
    issuedAt: formData.get("issuedAt"),
  });
  if (!result.ok) {
    redirect(`/faktura/${encodeURIComponent(invoiceId)}?error=${encodeURIComponent(resultCode(result))}`);
  }
  revalidatePath("/faktura");
  revalidatePath(`/faktura/${invoiceId}`);
  redirect(`/faktura/${encodeURIComponent(invoiceId)}?credit=1`);
}

export async function markOverdueAction() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (user.role !== "ADMIN" || !hasPermission(user, "settings.manage")) redirect("/");
  const count = await markOverdueInvoices();
  revalidatePath("/faktura");
  redirect(`/faktura?overdueSweep=${count}`);
}

export async function updateBillingSettingsAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await updateBillingSettings(user, {
    vatRate: formData.get("vatRate"),
    invoiceDueDays: formData.get("invoiceDueDays"),
    quoteValidityDays: formData.get("quoteValidityDays"),
    approvalTokenTtlHours: formData.get("approvalTokenTtlHours"),
    invoicePrefix: formData.get("invoicePrefix"),
    creditNotePrefix: formData.get("creditNotePrefix"),
  });
  if (!result.ok) {
    redirect(`/faktura/innstillinger?error=${encodeURIComponent(resultCode(result))}`);
  }
  revalidatePath("/faktura/innstillinger");
  redirect("/faktura/innstillinger?saved=1");
}
