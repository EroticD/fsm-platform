import { requireModulePage } from "@/lib/module-guards";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateLocalized } from "@/lib/dates";
import { listStaffReviews } from "@/server/reviews";
import EmptyState from "@/components/EmptyState";
import Pagination, { paginationLabels } from "@/components/Pagination";
import Icon from "@/components/icons";

const CARD = "office-card min-w-0 p-4 sm:p-5";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

function pageParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  return Math.max(1, Number.parseInt(raw ?? "1", 10) || 1);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("reviews.title") };
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("reviews");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.view")) redirect("/");

  const t = await getTranslations("common");
  const locale = await getLocale();
  const resolved = await searchParams;
  const page = pageParam(resolved.side);
  const result = await listStaffReviews(user, { page, pageSize: 20 });

  if (!result.ok) {
    return (
      <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
        <p role="alert" className={`${CARD} text-sm font-bold`}>
          {t("reviews.loadError")}
        </p>
      </div>
    );
  }

  const data = result.data;
  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className={CARD}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)] sm:text-3xl">
                {t("reviews.title")}
              </h1>
              <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                {t("reviews.subtitle")}
              </p>
            </div>
            <Link href="/" className={INK_BUTTON}>
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("reviews.back")}
            </Link>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                {t("reviews.average")}
              </p>
              <p className="mt-1 text-2xl font-black text-[var(--ink,#101310)]">
                {data.summary.average === null
                  ? "–"
                  : data.summary.average.toLocaleString(locale, {
                      maximumFractionDigits: 1,
                    })}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                {t("reviews.count")}
              </p>
              <p className="mt-1 text-2xl font-black text-[var(--ink,#101310)]">
                {data.summary.count}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
                {t("reviews.thisPage")}
              </p>
              <p className="mt-1 text-2xl font-black text-[var(--ink,#101310)]">
                {data.items.length}
              </p>
            </div>
          </div>
        </header>

        {data.items.length === 0 ? (
          <EmptyState
            icon={<Icon name="flag" className="h-6 w-6" />}
            title={t("reviews.empty")}
            description={t("reviews.emptyHint")}
          />
        ) : (
          <section className="space-y-2" aria-live="polite">
            {data.items.map((review) => (
              <article key={review.id} className={CARD}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-lg font-black text-[var(--ink,#101310)]">
                      {t("reviews.score", { score: review.score })}
                    </p>
                    <Link
                      href={`/oppdrag/${review.workOrder.id}`}
                      className="mt-1 block text-sm font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                    >
                      {review.workOrder.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-[var(--muted,#62685f)]">
                      {review.workOrder.customer?.name ??
                        t("reviews.noCustomer")}
                      {review.workOrder.reference
                        ? ` · ${review.workOrder.reference}`
                        : ""}
                      {" · "}
                      {formatDateLocalized(review.submittedAt, locale)}
                    </p>
                  </div>
                  <Link href={`/oppdrag/${review.workOrder.id}`} className={INK_BUTTON}>
                    {t("reviews.openOrder")}
                  </Link>
                </div>
                {review.comment ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ink,#101310)]">
                    {review.comment}
                  </p>
                ) : (
                  <p className="mt-2 text-xs italic text-[var(--muted,#62685f)]">
                    {t("reviews.noComment")}
                  </p>
                )}
              </article>
            ))}
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              hrefFor={(nextPage) =>
                nextPage > 1 ? `/anmeldelser?side=${nextPage}` : "/anmeldelser"
              }
              labels={paginationLabels(t)}
              summary={t("reviews.showing", {
                shown: data.items.length,
                total: data.total,
              })}
            />
          </section>
        )}
      </div>
    </div>
  );
}
