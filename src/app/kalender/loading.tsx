import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";

export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="office-app min-h-screen p-3 sm:p-6 lg:p-8"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-col gap-3 border-b border-[var(--line,#dedcd1)] pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-56 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-11 w-36" />
            <Skeleton className="h-11 w-36" />
          </div>
        </div>

        <div className="office-card flex gap-1 overflow-hidden px-2 pt-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-28 rounded-t-md" />
          ))}
        </div>

        <div className="office-card grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>

        <div className="office-card p-3 sm:p-4">
          <div className="mb-2 grid grid-cols-7 gap-1 sm:gap-2">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} className="h-3 w-8 justify-self-center" />
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {Array.from({ length: 35 }).map((_, index) => (
              <div
                key={index}
                className="space-y-2 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-2"
              >
                <Skeleton className="h-3 w-6" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        </div>

        <span className="sr-only">{t("components.loading")}</span>
      </div>
    </div>
  );
}
