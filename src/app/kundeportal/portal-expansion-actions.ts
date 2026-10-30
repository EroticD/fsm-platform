"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  createPortalTrackingLink,
  requestPortalReview,
  sendPortalMessage,
} from "@/server/portal-expansion";

export type PortalMessageState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; reason: string };

function portalError(reason: string): string {
  return reason === "forbidden" ||
    reason === "invalid" ||
    reason === "not_found" ||
    reason === "conflict" ||
    reason === "rate_limited"
    ? reason
    : "error";
}

export async function openTrackingAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await createPortalTrackingLink(user, formData.get("visitId"));
  if (!result.ok) {
    redirect(`/kundeportal/besok?error=${encodeURIComponent(result.reason)}`);
  }
  redirect(`/sporing/${result.data.token}`);
}

export async function requestReviewAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await requestPortalReview(user, formData.get("visitId"));
  if (!result.ok) {
    redirect(`/kundeportal/besok?error=${encodeURIComponent(result.reason)}`);
  }
  if (result.data.token) redirect(`/anmeldelse/${result.data.token}`);
  redirect("/kundeportal/besok?review=requested");
}

export async function sendPortalMessageAction(
  _previous: PortalMessageState,
  formData: FormData,
): Promise<PortalMessageState> {
  const user = await getCurrentUser();
  if (!user) return { status: "error", reason: "forbidden" };
  const threadId = formData.get("threadId");
  const result = await sendPortalMessage(user, threadId, formData.get("body"));
  if (!result.ok) {
    return { status: "error", reason: portalError(result.reason) };
  }
  if (typeof threadId === "string") {
    revalidatePath(`/kundeportal/meldinger/${threadId}`);
  }
  revalidatePath("/kundeportal/meldinger");
  return { status: "success" };
}
