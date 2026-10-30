import { getTranslations, getLocale } from "next-intl/server";
import { formatDateTimeLocalized } from "@/lib/dates";
import PortalShell from "@/components/portal/PortalShell";
import { brandCard, brandInset } from "@/components/ui/brandStyles";
import { getPortalVisitTimeline, type PortalVisit } from "@/server/portal-expansion";
import {
  openTrackingAction,
  requestReviewAction,
} from "../portal-expansion-actions";
import { PortalNoAccess, loadPortalPage } from "../portal-page";

const ERROR_KEYS: Record<string, string> = {
  forbidden: "portal.expansion.visits.errors.forbidden",
  invalid: "portal.expansion.visits.errors.invalid",
  not_found: "portal.expansion.visits.errors.notFound",
  conflict: "portal.expansion.visits.errors.conflict",
  error: "portal.expansion.visits.errors.generic",
};

async function VisitCard({ visit }: { visit: PortalVisit }) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  return (
    <li className={`${brandInset} min-w-0 p-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-bold">{visit.workOrderTitle}</p>
          <p className="text-xs text-[var(--muted,#62685f)]">
            {formatDateTimeLocalized(visit.startsAt, locale)} –{" "}
            {formatDateTimeLocalized(visit.endsAt, locale)}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1 text-xs font-bold">
          {t(`portal.expansion.visits.statuses.${visit.status}`)}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--muted,#62685f)]">
        {visit.siteName ? `${visit.siteName} · ` : ""}
        {visit.address || t("portal.expansion.visits.addressUnavailable")}
      </p>
      {visit.technicians.length > 0 && (
        <p className="mt-1 text-xs font-bold">
          {t("portal.expansion.visits.technicians", {
            names: visit.technicians.join(", "),
          })}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {visit.canTrack && (
          <form action={openTrackingAction}>
            <input type="hidden" name="visitId" value={visit.id} />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-full border border-[var(--ink,#101310)] px-4 text-sm font-bold transition hover:bg-[var(--paper,#f2efe6)]"
            >
              {visit.hasActiveTracking
                ? t("portal.expansion.visits.refreshTracking")
                : t("portal.expansion.visits.openTracking")}
            </button>
          </form>
        )}
        {visit.canReview && (
          <form action={requestReviewAction}>
            <input type="hidden" name="visitId" value={visit.id} />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-full border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] px-4 text-sm font-bold text-[var(--paper,#f2efe6)]"
            >
              {t("portal.expansion.visits.review")}
            </button>
          </form>
        )}
        {visit.reviewSubmitted && (
          <span className="inline-flex min-h-11 items-center text-xs font-bold text-[#24502f]">
            {t("portal.expansion.visits.reviewDone")}
          </span>
        )}
      </div>
    </li>
  );
}

export default async function PortalVisitsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; review?: string }>;
}) {
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const t = await getTranslations("common");
  const params = await searchParams;
  const result = await getPortalVisitTimeline(context.user);

  return (
    <PortalShell
      active="besok"
      customer={context.customer}
      userName={context.user.name ?? context.user.email ?? ""}
    >
      <section className={`${brandCard} p-4 sm:p-5`}>
        <h2 className="text-lg font-extrabold tracking-tight">
          {t("portal.expansion.visits.title")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
          {t("portal.expansion.visits.intro")}
        </p>

        {params.error && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-[#e7b7a4] bg-[#fae8e0] px-3 py-2 text-sm font-bold text-[#a92a12]"
          >
            {t(ERROR_KEYS[params.error] ?? "portal.expansion.visits.errors.generic")}
          </p>
        )}
        {params.review === "requested" && (
          <p
            role="status"
            className="mt-3 rounded-xl border border-[#b9cdb4] bg-[#eaf3e4] px-3 py-2 text-sm font-bold text-[#24502f]"
          >
            {t("portal.expansion.visits.reviewRequested")}
          </p>
        )}

        {!result.ok ? (
          <p className="mt-4 text-sm text-[var(--muted,#62685f)]">
            {t("portal.expansion.visits.errors.forbidden")}
          </p>
        ) : (
          <div className="mt-4 space-y-6">
            <div>
              <h3 className="mb-2 text-sm font-extrabold uppercase tracking-[0.1em] text-[var(--muted,#62685f)]">
                {t("portal.expansion.visits.upcoming")}
              </h3>
              {result.data.upcoming.length === 0 ? (
                <p className="text-sm italic text-[var(--muted,#62685f)]">
                  {t("portal.expansion.visits.emptyUpcoming")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {result.data.upcoming.map((visit) => (
                    <VisitCard key={visit.id} visit={visit} />
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-extrabold uppercase tracking-[0.1em] text-[var(--muted,#62685f)]">
                {t("portal.expansion.visits.past")}
              </h3>
              {result.data.past.length === 0 ? (
                <p className="text-sm italic text-[var(--muted,#62685f)]">
                  {t("portal.expansion.visits.emptyPast")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {result.data.past.map((visit) => (
                    <VisitCard key={visit.id} visit={visit} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
    </PortalShell>
  );
}
