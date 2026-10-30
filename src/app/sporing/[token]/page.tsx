import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import BrandMark from "@/components/BrandMark";
import { formatDateTimeLocalized } from "@/lib/dates";
import { VISIT_STATUS_LABEL_KEYS } from "@/lib/visit-status";
import { getPublicTracking } from "@/server/tracking";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("tracking.public.metaTitle"),
    robots: { index: false, follow: false },
  };
}

/**
 * Offentlig sporingsside. Den krever ingen innlogging, men viser bare data så
 * lenge lenken er gyldig og visitten faktisk er EN_ROUTE eller ON_SITE.
 * Koordinater sendes aldri til nettleseren.
 */
export default async function PublicTrackingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await getPublicTracking(token);

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      const t = await getTranslations("common");
      return (
        <PublicShell>
          <h1 className="text-2xl font-black text-[var(--ink,#101310)]">
            {t("tracking.public.rateLimitedTitle")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted,#62685f)]">
            {t("tracking.public.rateLimitedText", {
              seconds: result.retryAfterSeconds,
            })}
          </p>
        </PublicShell>
      );
    }
    notFound();
  }

  const t = await getTranslations("common");
  const locale = await getLocale();
  const tracking = result.data;
  const technician =
    tracking.technicianFirstName ?? t("tracking.public.technicianFallback");
  const lastUpdated = tracking.lastUpdatedAt
    ? formatDateTimeLocalized(tracking.lastUpdatedAt, locale)
    : null;
  const arrival = tracking.estimatedArrivalAt
    ? formatDateTimeLocalized(tracking.estimatedArrivalAt, locale)
    : null;

  return (
    <PublicShell>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--muted,#62685f)]">
        {t("tracking.public.eyebrow")}
      </p>
      <h1 className="mt-2 text-2xl font-black tracking-tight text-[var(--ink,#101310)]">
        {t("tracking.public.title")}
      </h1>
      <p className="mt-2 text-sm leading-6 text-[var(--muted,#62685f)]">
        {t("tracking.public.intro", { technician })}
      </p>

      <div className="mt-5 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-4">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
          {t("tracking.public.statusLabel")}
        </p>
        <p className="mt-1 text-lg font-black text-[var(--ink,#101310)]">
          {t(VISIT_STATUS_LABEL_KEYS[tracking.status])}
        </p>

        {tracking.status === "EN_ROUTE" && tracking.etaMinutes !== null && (
          <div className="mt-4 border-t border-[var(--line,#dedcd1)] pt-3">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
              {t("tracking.public.etaLabel")}
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums text-[var(--ink,#101310)]">
              {t("tracking.public.etaMinutes", {
                count: tracking.etaMinutes,
              })}
            </p>
            {arrival && (
              <p className="mt-1 text-sm font-medium text-[var(--muted,#62685f)]">
                {t("tracking.public.etaArrival", { time: arrival })}
              </p>
            )}
          </div>
        )}

        {tracking.status === "ON_SITE" && (
          <p className="mt-3 border-t border-[var(--line,#dedcd1)] pt-3 text-sm font-bold text-[var(--ink,#101310)]">
            {t("tracking.public.onSite")}
          </p>
        )}

        {tracking.status === "EN_ROUTE" && tracking.etaMinutes === null && (
          <p className="mt-3 border-t border-[var(--line,#dedcd1)] pt-3 text-sm font-medium text-[var(--muted,#62685f)]">
            {t("tracking.public.etaUnavailable")}
          </p>
        )}

        <p className="mt-3 border-t border-[var(--line,#dedcd1)] pt-3 text-sm font-medium text-[var(--muted,#62685f)]">
          {lastUpdated
            ? t("tracking.public.lastUpdated", { time: lastUpdated })
            : t("tracking.public.noPosition")}
        </p>
      </div>

      <p className="mt-4 text-xs leading-5 text-[var(--muted,#62685f)]">
        {t("tracking.public.privacy")}
      </p>
      <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
        {t("tracking.public.refreshHint")}
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
