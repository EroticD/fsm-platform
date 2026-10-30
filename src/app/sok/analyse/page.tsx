import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import SearchAnalyticsView from "@/components/sok/SearchAnalyticsView";
import { parseSearchAnalyticsDays } from "@/lib/search-analytics-format";
import { getCurrentUser } from "@/lib/session";
import { getSearchAnalytics } from "@/server/search-analytics";

export default async function SearchAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user?.isActive) redirect("/api/auth/signin");

  const resolvedParams = await searchParams;
  const days = parseSearchAnalyticsDays(resolvedParams.days);

  // Tjenestelaget er autoriteten: det krever audit.view eller administrator og
  // returnerer forbidden også når noen går rett på URL-en.
  const analytics = await getSearchAnalytics(user, days);
  if (!analytics.ok) redirect("/");

  const t = await getTranslations("common");

  return (
    <div className="min-h-screen bg-[var(--canvas,#f4f5f2)] p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title={t("searchAdmin.title")}
          subtitle={t("searchAdmin.subtitle")}
          icon={<Icon name="chart" className="h-5 w-5" />}
          actions={
            <Link
              href="/sok"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("searchAdmin.backToSearch")}
            </Link>
          }
        />

        <SearchAnalyticsView data={analytics.data} selectedDays={days} />
      </div>
    </div>
  );
}
