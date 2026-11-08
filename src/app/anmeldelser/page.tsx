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
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Pagination, { paginationLabels } from "@/components/Pagination";
import Card from "@/components/ui/Card";
import { buttonClassName } from "@/components/ui/Button";
import { brandInset } from "@/components/ui/brandStyles";
import Icon from "@/components/icons";

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
      <PageShell size="narrow">
        <PageHeader
          title={t("reviews.title")}
          subtitle={t("reviews.subtitle")}
          icon={<Icon name="flag" className="h-5 w-5" />}
        />
        <ErrorBanner message={t("reviews.loadError")} />
      </PageShell>
    );
  }

  const data = result.data;
  const summary = [
    {
      label: t("reviews.average"),
      value:
        data.summary.average === null
          ? "–"
          : data.summary.average.toLocaleString(locale, {
              maximumFractionDigits: 1,
            }),
    },
    { label: t("reviews.count"), value: data.summary.count },
    { label: t("reviews.thisPage"), value: data.items.length },
  ];

  return (
    <PageShell>
      <PageHeader
        title={t("reviews.title")}
        subtitle={t("reviews.subtitle")}
        icon={<Icon name="flag" className="h-5 w-5" />}
        actions={
          <Link
            href="/"
            className={buttonClassName({ variant: "secondary", size: "sm" })}
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("reviews.back")}
          </Link>
        }
      />

      <section className="grid gap-2 sm:grid-cols-3" aria-label={t("reviews.title")}>
        {summary.map((item) => (
          <div key={item.label} className={`${brandInset} p-3`}>
            <p className="type-eyebrow text-muted">{item.label}</p>
            <p className="mt-1 text-2xl font-black text-ink">{item.value}</p>
          </div>
        ))}
      </section>

      {data.items.length === 0 ? (
        <EmptyState
          icon={<Icon name="flag" className="h-6 w-6" />}
          title={t("reviews.empty")}
          description={t("reviews.emptyHint")}
        />
      ) : (
        <section className="space-y-2" aria-live="polite">
          {data.items.map((review) => (
            <Card key={review.id} as="article" className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-lg font-black text-ink">
                    {t("reviews.score", { score: review.score })}
                  </p>
                  <Link
                    href={`/oppdrag/${review.workOrder.id}`}
                    className="mt-1 block text-sm font-bold text-ink underline decoration-signal decoration-2 underline-offset-4"
                  >
                    {review.workOrder.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">
                    {review.workOrder.customer?.name ??
                      t("reviews.noCustomer")}
                    {review.workOrder.reference
                      ? ` · ${review.workOrder.reference}`
                      : ""}
                    {" · "}
                    {formatDateLocalized(review.submittedAt, locale)}
                  </p>
                </div>
                <Link
                  href={`/oppdrag/${review.workOrder.id}`}
                  className={buttonClassName({ variant: "secondary", size: "sm" })}
                >
                  {t("reviews.openOrder")}
                </Link>
              </div>
              {review.comment ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink">
                  {review.comment}
                </p>
              ) : (
                <p className="mt-2 text-xs italic text-muted">
                  {t("reviews.noComment")}
                </p>
              )}
            </Card>
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
    </PageShell>
  );
}
