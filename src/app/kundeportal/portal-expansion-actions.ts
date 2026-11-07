"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { moduleEnabled } from "@/server/modules";
import {
  createPortalSite,
  createPortalTrackingLink,
  deletePortalSite,
  requestPortalReview,
  sendPortalMessage,
  setPortalPrimarySite,
  updatePortalSite,
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
  if (!(await moduleEnabled("portal")) || !(await moduleEnabled("tracking"))) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await createPortalTrackingLink(user, formData.get("visitId"));
  if (!result.ok) {
    redirect(`/kundeportal/besok?error=${encodeURIComponent(result.reason)}`);
  }
  redirect(`/sporing/${result.data.token}`);
}

export async function requestReviewAction(formData: FormData) {
  if (!(await moduleEnabled("portal")) || !(await moduleEnabled("reviews"))) redirect("/");
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

function siteRedirect(result: { ok: boolean; reason?: string }, saved = false) {
  if (!result.ok) {
    const reason = portalError(result.reason ?? "error");
    redirect(`/kundeportal/bestillinger?feil=${reason}#steder`);
  }
  if (saved) {
    revalidatePath("/kundeportal");
    revalidatePath("/kundeportal/bestillinger");
  }
  redirect("/kundeportal/bestillinger?lagret=1#steder");
}

export async function createPortalSiteAction(formData: FormData) {
  if (!(await moduleEnabled("portal"))) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await createPortalSite(user, {
    name: formData.get("name"),
    address: formData.get("address"),
    postalCode: formData.get("postalCode"),
    city: formData.get("city"),
    isPrimary: formData.get("isPrimary"),
  });
  siteRedirect(result, true);
}

export async function updatePortalSiteAction(formData: FormData) {
  if (!(await moduleEnabled("portal"))) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await updatePortalSite(user, formData.get("id"), {
    name: formData.get("name"),
    address: formData.get("address"),
    postalCode: formData.get("postalCode"),
    city: formData.get("city"),
    isPrimary: formData.get("isPrimary"),
  });
  siteRedirect(result, true);
}

export async function deletePortalSiteAction(formData: FormData) {
  if (!(await moduleEnabled("portal"))) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await deletePortalSite(user, formData.get("id"));
  siteRedirect(result, true);
}

export async function setPortalPrimarySiteAction(formData: FormData) {
  if (!(await moduleEnabled("portal"))) redirect("/");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const result = await setPortalPrimarySite(user, formData.get("id"));
  siteRedirect(result, true);
}
