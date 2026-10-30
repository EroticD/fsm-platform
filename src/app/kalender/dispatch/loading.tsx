import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";

/** Skjelett for dispatchtavla: datoverktøy og horisontale montørlaner. */
export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="office-app min-h-screen overflow-x-hidden p-3 sm:p-6 lg:p-8"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto min-w-0 max-w-7xl space-y-4" aria-hidden="true">
        <div className="flex flex-col gap-3 border-b border-[var(--line,#dedcd1)] pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-56 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-11 w-36" />
            <Skeleton className="h-11 w-28" />
          </div>
        </div>

        <div className="office-card flex gap-1 overflow-hidden px-2 pt-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-28 rounded-t-md" />
          ))}
        </div>

        {/* Datoverktøy */}
        <div className="office-card grid min-w-0 grid-cols-1 gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-5">
          <div className="space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="flex items-end gap-2">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 w-20" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Skeleton className="h-4 w-52" />
          <Skeleton className="h-8 w-24" />
        </div>

        {/* To dager med laner, som DispatchBoard. */}
        {Array.from({ length: 2 }).map((_, dayIndex) => (
          <div
            key={dayIndex}
            className="office-card min-w-0 max-w-full p-3 sm:p-4"
          >
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
              <Skeleton className="h-6 w-48 max-w-full" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex min-w-0 max-w-full gap-3 overflow-x-auto pb-1">
              {Array.from({ length: 3 }).map((_, laneIndex) => (
                <div
                  key={laneIndex}
                  className="w-72 max-w-full shrink-0 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]/70 p-2"
                >
                  <div className="mb-2 flex items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] px-1 pb-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-6" />
                  </div>
                  <div className="space-y-2">
                    {Array.from({ length: 2 }).map((_, cardIndex) => (
                      <div
                        key={cardIndex}
                        className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3"
                      >
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="mt-2 h-3 w-1/2" />
                        <Skeleton className="mt-2 h-3 w-full" />
                        <Skeleton className="mt-1 h-3 w-2/3" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only">{t("components.loading")}</span>
    </div>
  );
}
