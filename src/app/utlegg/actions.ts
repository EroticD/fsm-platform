"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { safeRelativeTarget } from "@/lib/safe-redirect";
import { moduleEnabled } from "@/server/modules";
import {
  approveExpense,
  approveMileageTrip,
  createExpense,
  createMileageTrip,
  rejectExpense,
  rejectMileageTrip,
  submitExpense,
  submitMileageTrip,
} from "@/server/expenses";

/** Tynne action-wrappere; forretningslogikken ligger i `src/server/expenses.ts`. */

function detailsCode(result: { details?: unknown }): string {
  const details = result.details;
  if (details && typeof details === "object" && "code" in details) {
    const code = (details as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

function backWith(
  formData: FormData,
  key: "meldt" | "feil",
  value: string,
  fallback: string,
): string {
  const path = safeRelativeTarget(String(formData.get("returnTo") ?? fallback));
  const url = new URL(path, "http://local.invalid");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

function revalidateExpenses() {
  revalidatePath("/utlegg");
  revalidatePath("/utlegg/kontor");
}

export async function createMileageTripAction(formData: FormData) {
  if (!(await moduleEnabled("fieldExpenses"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createMileageTrip(actor, {
    date: formData.get("date"),
    fromAddress: formData.get("fromAddress"),
    toAddress: formData.get("toAddress"),
    km: formData.get("km"),
    rate: formData.get("rate"),
    purpose: formData.get("purpose"),
    workOrderId: formData.get("workOrderId"),
    visitId: formData.get("visitId"),
    submit: formData.get("submit"),
  });
  if (!result.ok) {
    redirect(backWith(formData, "feil", detailsCode(result) || result.reason, "/utlegg"));
  }
  revalidateExpenses();
  redirect(backWith(formData, "meldt", "trip-created", "/utlegg"));
}

export async function createExpenseAction(formData: FormData) {
  if (!(await moduleEnabled("fieldExpenses"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await createExpense(actor, {
    date: formData.get("date"),
    category: formData.get("category"),
    amount: formData.get("amount"),
    vatRate: formData.get("vatRate"),
    vatAmount: formData.get("vatAmount"),
    description: formData.get("description"),
    receiptUrl: formData.get("receiptUrl"),
    documentId: formData.get("documentId"),
    workOrderId: formData.get("workOrderId"),
    visitId: formData.get("visitId"),
    submit: formData.get("submit"),
  });
  if (!result.ok) {
    redirect(backWith(formData, "feil", detailsCode(result) || result.reason, "/utlegg"));
  }
  revalidateExpenses();
  redirect(backWith(formData, "meldt", "expense-created", "/utlegg"));
}

export async function submitMileageTripAction(formData: FormData) {
  if (!(await moduleEnabled("fieldExpenses"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await submitMileageTrip(actor, String(formData.get("id") ?? ""));
  if (!result.ok) {
    redirect(backWith(formData, "feil", detailsCode(result) || result.reason, "/utlegg"));
  }
  revalidateExpenses();
  redirect(backWith(formData, "meldt", "trip-submitted", "/utlegg"));
}

export async function submitExpenseAction(formData: FormData) {
  if (!(await moduleEnabled("fieldExpenses"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await submitExpense(actor, String(formData.get("id") ?? ""));
  if (!result.ok) {
    redirect(backWith(formData, "feil", detailsCode(result) || result.reason, "/utlegg"));
  }
  revalidateExpenses();
  redirect(backWith(formData, "meldt", "expense-submitted", "/utlegg"));
}

export async function approveMileageTripAction(formData: FormData) {
  if (!(await moduleEnabled("fieldExpenses"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await approveMileageTrip(actor, String(formData.get("id") ?? ""));
  if (!result.ok) {
    redirect(backWith(formData, "feil", detailsCode(result) || result.reason, "/utlegg/kontor"));
  }
  revalidateExpenses();
  redirect(backWith(formData, "meldt", "trip-approved", "/utlegg/kontor"));
}

export async function rejectMileageTripAction(formData: FormData) {
  if (!(await moduleEnabled("fieldExpenses"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await rejectMileageTrip(
    actor,
    String(formData.get("id") ?? ""),
    formData.get("reason"),
  );
  if (!result.ok) {
    redirect(backWith(formData, "feil", detailsCode(result) || result.reason, "/utlegg/kontor"));
  }
  revalidateExpenses();
  redirect(backWith(formData, "meldt", "trip-rejected", "/utlegg/kontor"));
}

export async function approveExpenseAction(formData: FormData) {
  if (!(await moduleEnabled("fieldExpenses"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await approveExpense(actor, String(formData.get("id") ?? ""));
  if (!result.ok) {
    redirect(backWith(formData, "feil", detailsCode(result) || result.reason, "/utlegg/kontor"));
  }
  revalidateExpenses();
  redirect(backWith(formData, "meldt", "expense-approved", "/utlegg/kontor"));
}

export async function rejectExpenseAction(formData: FormData) {
  if (!(await moduleEnabled("fieldExpenses"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const result = await rejectExpense(
    actor,
    String(formData.get("id") ?? ""),
    formData.get("reason"),
  );
  if (!result.ok) {
    redirect(backWith(formData, "feil", detailsCode(result) || result.reason, "/utlegg/kontor"));
  }
  revalidateExpenses();
  redirect(backWith(formData, "meldt", "expense-rejected", "/utlegg/kontor"));
}
