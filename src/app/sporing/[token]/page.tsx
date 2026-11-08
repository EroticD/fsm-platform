import { requireModulePage } from "@/lib/module-guards";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import PublicShell from "@/components/public/PublicShell";
import { brandInset } from "@/components/ui/brandStyles";
import { VISIT_STATUS_LABEL_KEYS } from "@/lib/visit-status";
import { getPublicTracking } from "@/server/tracking";
import TrackingEtaLive from "./TrackingEtaLive";

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
  await requireModulePage("tracking");
  const { token } = await params;
  const result = await getPublicTracking(token);

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      const t = await getTranslations("common");
      return (
        <PublicShell>
          <h1 className="type-title-2 text-[var(--ink,#101310)]">
            {t("tracking.public.rateLimitedTitle")}
          </h1>
          <p className="type-ui mt-2 leading-6 text-[var(--muted,#62685f)]">
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

  return (
    <PublicShell>
      <p className="type-eyebrow text-[var(--muted,#62685f)]">
        {t("tracking.public.eyebrow")}
      </p>
      <h1 className="type-title-2 mt-2 text-[var(--ink,#101310)]">
        {t("tracking.public.title")}
      </h1>
      <p className="type-ui mt-2 leading-6 text-[var(--muted,#62685f)]">
        {t("tracking.public.intro", { technician })}
      </p>

      <div className={`${brandInset} mt-5 p-4`}>
        <p className="type-eyebrow text-[var(--muted,#62685f)]">
          {t("tracking.public.statusLabel")}
        </p>
        <p className="type-title-3 mt-1 text-[var(--ink,#101310)]">
          {t(VISIT_STATUS_LABEL_KEYS[tracking.status])}
        </p>

        {tracking.status === "EN_ROUTE" && (
          <TrackingEtaLive
            token={token}
            locale={locale}
            initial={{
              status: tracking.status,
              etaSource: tracking.etaSource,
              etaMinutes: tracking.etaMinutes,
              estimatedArrivalAt:
                tracking.estimatedArrivalAt?.toISOString() ?? null,
              plannedStartsAt: tracking.plannedStartsAt.toISOString(),
              lastUpdatedAt: tracking.lastUpdatedAt?.toISOString() ?? null,
              pingAgeMinutes: tracking.pingAgeMinutes,
              stale: tracking.stale,
              hasLivePosition: tracking.hasLivePosition,
            }}
          />
        )}

        {tracking.status === "ON_SITE" && (
          <p className="mt-3 border-t border-[var(--line,#dedcd1)] pt-3 text-sm font-bold text-[var(--ink,#101310)]">
            {t("tracking.public.onSite")}
          </p>
        )}
      </div>

      <p className="type-micro mt-4 leading-5 text-[var(--muted,#62685f)]">
        {t("tracking.public.privacy")}
      </p>
      <p className="type-micro mt-1 leading-5 text-[var(--muted,#62685f)]">
        {t("tracking.public.refreshHint")}
      </p>
    </PublicShell>
  );
}
