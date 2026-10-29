import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";

/** Skjelett for dispatchtavla: datoverktøy og horisontale montørlaner. */
export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="min-h-screen overflow-x-hidden bg-gray-50 p-4 sm:p-6 md:p-8"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto min-w-0 max-w-7xl space-y-6" aria-hidden="true">
        <div className="flex flex-col gap-4 border-b border-gray-300 pb-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>

        <div className="min-w-0 max-w-full overflow-x-auto">
          <div className="flex min-w-max gap-1 rounded-xl bg-gray-200 p-1">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-28 rounded-lg" />
            ))}
          </div>
        </div>

        {/* Datoverktøy */}
        <div className="grid min-w-0 grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-11 w-full" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-11 w-full" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-11 w-full" />
          </div>
          <div className="flex items-end gap-2">
            <Skeleton className="h-11 flex-1" />
            <Skeleton className="h-11 w-20" />
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
            className="min-w-0 max-w-full rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4"
          >
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 pb-2">
              <Skeleton className="h-6 w-48 max-w-full" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex min-w-0 max-w-full gap-3 overflow-x-auto pb-1">
              {Array.from({ length: 3 }).map((_, laneIndex) => (
                <div
                  key={laneIndex}
                  className="w-72 max-w-full shrink-0 rounded-xl border border-gray-200 bg-gray-50 p-2"
                >
                  <div className="mb-2 flex items-center justify-between gap-2 border-b border-gray-200 px-1 pb-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-6" />
                  </div>
                  <div className="space-y-2">
                    {Array.from({ length: 2 }).map((_, cardIndex) => (
                      <div
                        key={cardIndex}
                        className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
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
