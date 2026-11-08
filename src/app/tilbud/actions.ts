"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  acceptQuoteByToken,
  cloneQuote,
  convertQuoteToWorkOrder,
  createQuote,
  createQuoteVersion,
  rejectQuoteByToken,
  reissueQuoteToken,
  sendQuote,
  updateQuote,
  type QuoteInput,
} from "@/server/quotes";

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

function inputFrom(formData: FormData): QuoteInput {
  return {
    title: formData.get("title"),
    customerId: formData.get("customerId"),
    customerName: formData.get("customerName"),
    contactId: formData.get("contactId"),
    workOrderId: formData.get("workOrderId"),
    contractId: formData.get("contractId"),
    productId: formData.get("productId"),
    departmentId: formData.get("departmentId"),
    validUntil: formData.get("validUntil"),
    notes: formData.get("notes"),
    vatRate: formData.get("vatRate"),
    lines: linesFrom(formData),
  };
}

function resultCode(result: { ok: false; reason: string; details?: unknown }): string {
  const details = result.details as { code?: string } | undefined;
  return details?.code ?? result.reason;
}

export async function createQuoteAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await createQuote(user, inputFrom(formData));
  if (!result.ok) redirect(`/tilbud/ny?error=${encodeURIComponent(resultCode(result))}`);
  revalidatePath("/tilbud");
  redirect(`/tilbud/${result.data.id}`);
}

export async function updateQuoteAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const quoteId = String(formData.get("id") ?? "");
  const result = await updateQuote(user, quoteId, inputFrom(formData));
  if (!result.ok) {
    redirect(
      `/tilbud/${encodeURIComponent(quoteId)}/rediger?error=${encodeURIComponent(resultCode(result))}`,
    );
  }
  revalidatePath("/tilbud");
  revalidatePath(`/tilbud/${quoteId}`);
  redirect(`/tilbud/${result.data.id}`);
}

export async function sendQuoteAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const quoteId = String(formData.get("id") ?? "");
  const result = await sendQuote(user, quoteId);
  if (!result.ok) {
    redirect(`/tilbud/${encodeURIComponent(quoteId)}?error=${encodeURIComponent(resultCode(result))}`);
  }
  revalidatePath(`/tilbud/${quoteId}`);
  redirect(
    `/tilbud/${encodeURIComponent(quoteId)}?token=${encodeURIComponent(result.data.token)}&sent=1`,
  );
}

export async function reissueQuoteTokenAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const quoteId = String(formData.get("id") ?? "");
  const result = await reissueQuoteToken(user, quoteId);
  if (!result.ok) {
    redirect(`/tilbud/${encodeURIComponent(quoteId)}?error=${encodeURIComponent(resultCode(result))}`);
  }
  revalidatePath(`/tilbud/${quoteId}`);
  redirect(
    `/tilbud/${encodeURIComponent(quoteId)}?token=${encodeURIComponent(result.data.token)}&sent=1`,
  );
}

export async function createQuoteVersionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const quoteId = String(formData.get("id") ?? "");
  const result = await createQuoteVersion(user, quoteId);
  if (!result.ok) {
    redirect(`/tilbud/${encodeURIComponent(quoteId)}?error=${encodeURIComponent(resultCode(result))}`);
  }
  revalidatePath(`/tilbud/${quoteId}`);
  redirect(`/tilbud/${encodeURIComponent(quoteId)}?versioned=1`);
}

export async function cloneQuoteAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const quoteId = String(formData.get("id") ?? "");
  const result = await cloneQuote(user, quoteId);
  if (!result.ok) {
    redirect(`/tilbud/${encodeURIComponent(quoteId)}?error=${encodeURIComponent(resultCode(result))}`);
  }
  revalidatePath("/tilbud");
  redirect(`/tilbud/${result.data.id}`);
}

export async function convertQuoteAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const quoteId = String(formData.get("id") ?? "");
  const result = await convertQuoteToWorkOrder(user, quoteId);
  if (!result.ok) {
    redirect(`/tilbud/${encodeURIComponent(quoteId)}?error=${encodeURIComponent(resultCode(result))}`);
  }
  revalidatePath(`/tilbud/${quoteId}`);
  redirect(`/oppdrag/${result.data.workOrderId}`);
}

export async function acceptQuoteAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const result = await acceptQuoteByToken(token, {
    name: formData.get("name"),
    comment: formData.get("comment"),
  });
  if (!result.ok) {
    redirect(
      `/tilbud/godkjenn/${encodeURIComponent(token)}?error=${encodeURIComponent(resultCode(result))}`,
    );
  }
  redirect(`/tilbud/godkjenn/${encodeURIComponent(token)}?result=accepted`);
}

export async function rejectQuoteAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const result = await rejectQuoteByToken(token, {
    name: formData.get("name"),
    reason: formData.get("reason"),
  });
  if (!result.ok) {
    redirect(
      `/tilbud/godkjenn/${encodeURIComponent(token)}?error=${encodeURIComponent(resultCode(result))}`,
    );
  }
  redirect(`/tilbud/godkjenn/${encodeURIComponent(token)}?result=rejected`);
}
