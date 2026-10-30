import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";
import { LEGACY_SURFACE } from "@/components/customer/customerStyles";

export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="office-app min-h-screen p-3 sm:p-6 lg:p-8"
      role="status"
      aria-live="polite"
    >
      <div className={`mx-auto max-w-6xl space-y-4 ${LEGACY_SURFACE}`}>
        <div className="flex flex-col gap-3 border-b border-[var(--line,#dedcd1)] pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-9 w-52 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-11 w-32" />
            <Skeleton className="h-11 w-36" />
          </div>
        </div>

        <div className="office-card space-y-3 p-3 sm:p-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <Skeleton className="h-11 flex-1" />
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-20" />
          </div>
          <div className="border-t border-[var(--line,#dedcd1)] pt-3">
            <Skeleton className="h-11 w-36" />
          </div>
        </div>

        <div className="office-card overflow-hidden">
          <div className="flex gap-4 bg-[var(--ink,#101310)] p-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="h-3 flex-1 rounded bg-[var(--paper,#f2efe6)] opacity-40"
              />
            ))}
          </div>
          <div className="divide-y divide-[var(--line,#dedcd1)]">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="flex items-center gap-4 p-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-4 w-1/5" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="ml-auto h-11 w-24" />
              </div>
            ))}
          </div>
        </div>

        <span className="sr-only">{t("components.loading")}</span>
      </div>
    </div>
  );
}
