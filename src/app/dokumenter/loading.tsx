import { getTranslations } from "next-intl/server";
import { Skeleton, SkeletonCard } from "@/components/Skeleton";

export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-3 border-b border-gray-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 flex-1" />
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-11 w-24" />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonCard key={index} lines={2} />
            ))}
          </div>
        </div>

        <span className="sr-only">{t("components.loading")}</span>
      </div>
    </div>
  );
}
