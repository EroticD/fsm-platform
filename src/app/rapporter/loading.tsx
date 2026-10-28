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
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex flex-col gap-3 border-b border-gray-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-28" />
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-24" />
            ))}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-8 w-28" />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonCard key={index} lines={2} />
          ))}
        </div>

        <span className="sr-only">{t("components.loading")}</span>
      </div>
    </div>
  );
}
