import { getTranslations } from "next-intl/server";
import { Skeleton, SkeletonCard } from "@/components/Skeleton";

export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="min-h-screen bg-field p-4 pb-32 text-paper sm:p-6 sm:pb-12"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-col justify-between gap-3 border-b border-[#2a3328] pb-4 sm:flex-row sm:items-center">
          <div className="space-y-2">
            <Skeleton className="h-7 w-56 max-w-full bg-white/10" />
            <Skeleton className="h-4 w-64 max-w-full bg-white/[0.07]" />
          </div>
          <Skeleton className="h-10 w-24 bg-white/10" />
        </div>

        <div className="rounded-[1.75rem] border border-[#2a3328] bg-field-card p-4 shadow-sm">
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <Skeleton className="h-12 flex-1 bg-white/10" />
            <Skeleton className="h-12 w-24 bg-white/10" />
          </div>
        </div>

        <div className="space-y-4">
          <Skeleton className="h-6 w-48 bg-white/10" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonCard key={index} lines={3} />
            ))}
          </div>
        </div>

        <span className="sr-only">{t("components.loading")}</span>
      </div>
    </div>
  );
}
