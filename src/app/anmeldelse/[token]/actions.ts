"use server";

import { redirect } from "next/navigation";
import { submitReview } from "@/server/reviews";

/**
 * Sender inn en offentlig omtale. Tokenet er en bærbar hemmelighet, og
 * tjenestelaget avgjør om det finnes, om det allerede er brukt og om
 * poengsummen er gyldig. Vi redirecter alltid tilbake til samme token-side.
 */
export async function submitReviewAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const score = Number(formData.get("score"));
  const comment = formData.get("comment");

  const result = await submitReview(token, {
    score,
    comment: typeof comment === "string" ? comment : null,
  });

  const path = `/anmeldelse/${encodeURIComponent(token)}`;

  if (!result.ok) {
    const code =
      result.details &&
      typeof result.details === "object" &&
      "code" in result.details &&
      typeof (result.details as { code?: unknown }).code === "string"
        ? (result.details as { code: string }).code
        : result.reason;
    redirect(`${path}?error=${encodeURIComponent(code)}`);
  }

  redirect(`${path}?ok=1`);
}
