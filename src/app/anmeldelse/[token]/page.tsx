import { requireModulePage } from "@/lib/module-guards";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import ErrorBanner from "@/components/ErrorBanner";
import PublicShell from "@/components/public/PublicShell";
import SubmitButton from "@/components/SubmitButton";
import Field from "@/components/ui/Field";
import Textarea from "@/components/ui/Textarea";
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
  await requireModulePage("reviews");
  const { token } = await params;
  const { error } = await searchParams;
  const result = await getPublicReview(token);

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      const t = await getTranslations("common");
      return (
        <PublicShell>
          <h1 className="type-title-2 text-[var(--ink,#101310)]">
            {t("reviews.public.rateLimitedTitle")}
          </h1>
          <p className="type-ui mt-2 leading-6 text-[var(--muted,#62685f)]">
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
        <h1 className="type-title-2 text-[var(--ink,#101310)]">
          {t("reviews.public.thanksTitle")}
        </h1>
        <p className="type-ui mt-2 leading-6 text-[var(--muted,#62685f)]">
          {t("reviews.public.thanksText")}
        </p>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <p className="type-eyebrow text-[var(--muted,#62685f)]">
        {t("reviews.public.eyebrow")}
      </p>
      <h1 className="type-title-2 mt-2 text-[var(--ink,#101310)]">
        {t("reviews.public.title")}
      </h1>
      <p className="type-ui mt-2 leading-6 text-[var(--muted,#62685f)]">
        {t("reviews.public.intro")}
      </p>

      {errorKey && (
        <ErrorBanner message={t(errorKey)} className="mt-4" />
      )}

      <form action={submitReviewAction} className="mt-5 space-y-5">
        <input type="hidden" name="token" value={token} />
        <fieldset>
          <legend className="type-eyebrow text-[var(--muted,#62685f)]">
            {t("reviews.public.scoreLabel")}
          </legend>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((score) => (
              <label
                key={score}
                className="flex min-h-12 cursor-pointer flex-col items-center justify-center rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-base font-black text-[var(--ink,#101310)] transition has-[:checked]:border-[var(--ink,#101310)] has-[:checked]:bg-[var(--signal,#d8ff3e)]"
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
          <div className="type-micro mt-1 flex justify-between text-[var(--muted,#62685f)]">
            <span>{t("reviews.public.scoreLow")}</span>
            <span>{t("reviews.public.scoreHigh")}</span>
          </div>
        </fieldset>

        <Field label={t("reviews.public.commentLabel")}>
          <Textarea
            name="comment"
            rows={5}
            maxLength={2000}
            placeholder={t("reviews.public.commentPlaceholder")}
          />
        </Field>

        <SubmitButton
          pendingLabel={t("reviews.public.submitting")}
          className="signal-button min-h-11 w-full text-sm"
        >
          {t("reviews.public.submit")}
        </SubmitButton>
      </form>

      <p className="type-micro mt-4 leading-5 text-[var(--muted,#62685f)]">
        {t("reviews.public.privacy")}
      </p>
    </PublicShell>
  );
}
