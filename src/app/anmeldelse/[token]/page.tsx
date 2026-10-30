import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import BrandMark from "@/components/BrandMark";
import SubmitButton from "@/components/SubmitButton";
import { getPublicReview } from "@/server/reviews";
import { submitReviewAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("reviews.public.metaTitle"),
    robots: { index: false, follow: false },
  };
}

const ERROR_KEYS: Record<string, string> = {
  "reviews.errors.alreadySubmitted": "reviews.public.alreadySubmitted",
  "reviews.errors.invalidScore": "reviews.public.invalidScore",
  "reviews.errors.invalidToken": "reviews.public.invalidToken",
  "reviews.errors.rateLimited": "reviews.public.rateLimited",
};

/**
 * Offentlig omtaleside. Den viser ingen kunde- eller opplysningsopplysninger,
 * og innsendt innhold publiseres aldri – det brukes bare internt til
 * dashbordets aggregat.
 */
export default async function PublicReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const result = await getPublicReview(token);

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      const t = await getTranslations("common");
      return (
        <PublicShell>
          <h1 className="text-2xl font-black text-[var(--ink,#101310)]">
            {t("reviews.public.rateLimitedTitle")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted,#62685f)]">
            {t("reviews.public.rateLimitedText", {
              seconds: result.retryAfterSeconds,
            })}
          </p>
        </PublicShell>
      );
    }
    notFound();
  }

  const t = await getTranslations("common");
  const submitted = result.data.submitted;
  const errorKey = error ? ERROR_KEYS[error] : null;

  if (submitted) {
    return (
      <PublicShell>
        <h1 className="text-2xl font-black text-[var(--ink,#101310)]">
          {t("reviews.public.thanksTitle")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted,#62685f)]">
          {t("reviews.public.thanksText")}
        </p>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--muted,#62685f)]">
        {t("reviews.public.eyebrow")}
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-[var(--ink,#101310)]">
        {t("reviews.public.title")}
      </h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted,#62685f)]">
        {t("reviews.public.intro")}
      </p>

      {errorKey && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] px-3 py-2 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t(errorKey)}
        </p>
      )}

      <form action={submitReviewAction} className="mt-5 space-y-5">
        <input type="hidden" name="token" value={token} />
        <fieldset>
          <legend className="text-xs font-black uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
            {t("reviews.public.scoreLabel")}
          </legend>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((score) => (
              <label
                key={score}
                className="flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-xl border border-[var(--line,#dedcd1)] bg-white text-base font-black text-[var(--ink,#101310)] transition has-[:checked]:border-[var(--ink,#101310)] has-[:checked]:bg-[var(--signal,#d8ff3e)]"
              >
                <input
                  type="radio"
                  name="score"
                  value={score}
                  required
                  className="sr-only"
                />
                {score}
              </label>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs font-medium text-[var(--muted,#62685f)]">
            <span>{t("reviews.public.scoreLow")}</span>
            <span>{t("reviews.public.scoreHigh")}</span>
          </div>
        </fieldset>

        <div>
          <label
            htmlFor="review-comment"
            className="mb-1 block text-xs font-black uppercase tracking-[0.12em] text-[var(--muted,#62685f)]"
          >
            {t("reviews.public.commentLabel")}
          </label>
          <textarea
            id="review-comment"
            name="comment"
            rows={5}
            maxLength={2000}
            placeholder={t("reviews.public.commentPlaceholder")}
            className="min-h-28 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-white px-3 py-2 text-sm font-medium text-[var(--ink,#101310)] outline-none focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
          />
        </div>

        <SubmitButton
          pendingLabel={t("reviews.public.submitting")}
          className="signal-button min-h-11 w-full text-sm"
        >
          {t("reviews.public.submit")}
        </SubmitButton>
      </form>

      <p className="mt-4 text-xs leading-5 text-[var(--muted,#62685f)]">
        {t("reviews.public.privacy")}
      </p>
    </PublicShell>
  );
}

function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas,#f4f5f2)] p-4 text-[var(--ink,#101310)] sm:p-6">
      <div className="w-full max-w-md rounded-[20px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-6 shadow-[0_2px_0_rgba(20,17,11,0.08),0_18px_40px_rgba(20,17,11,0.08)] sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <BrandMark size={36} />
          <span className="text-sm font-black uppercase tracking-[0.12em] text-[var(--ink,#101310)]">
            FSM System
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
