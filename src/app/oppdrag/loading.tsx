import { getTranslations } from "next-intl/server";
import { Skeleton, SkeletonCard } from "@/components/Skeleton";

export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="office-app min-h-screen p-3 sm:p-6 lg:p-8"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--line,#dedcd1)] pb-4 md:flex-row md:items-end">
          <div className="space-y-2">
            <Skeleton className="h-8 w-56 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 w-28" />
            <Skeleton className="h-11 w-32" />
          </div>
        </div>

        <div className="office-card space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-24" />
            ))}
          </div>
          <Skeleton className="h-11 w-full" />
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
