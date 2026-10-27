import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              📈 {t("searchAdmin.title")}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {t("searchAdmin.subtitle")}
            </p>
          </div>
          <Link
            href="/sok"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            &larr; {t("searchAdmin.backToSearch")}
          </Link>
        </header>

        <SearchAnalyticsView data={analytics.data} selectedDays={days} />
      </div>
    </div>
  );
}
