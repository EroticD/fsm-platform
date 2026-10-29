import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";

/** Skjelett for oppdragsdetalen: header med status/dato/handlinger og to kolonner. */
export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-5xl space-y-6" aria-hidden="true">
        <header className="space-y-3 border-b border-gray-300 pb-4">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Skeleton className="h-8 w-64 max-w-full" />
                <Skeleton className="h-7 w-24 rounded-full" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-7 w-40 rounded-full" />
                <Skeleton className="h-7 w-28 rounded-full" />
                <Skeleton className="h-7 w-32 rounded-full" />
              </div>

              <div className="space-y-2">
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-4 w-72 max-w-full" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </div>

              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-32 rounded-full" />
              </div>
            </div>

            <div className="flex flex-wrap items-start gap-2 lg:max-w-md lg:justify-end">
              <Skeleton className="h-11 w-28" />
              <Skeleton className="h-11 w-32" />
              <Skeleton className="h-11 w-28" />
              <Skeleton className="h-11 w-36" />
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Høyrekolonnen i desktop-visningen; først i DOM slik som siden. */}
          <div className="space-y-6 lg:col-start-3 lg:row-start-1">
            <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <Skeleton className="h-5 w-40" />
              <div className="mt-4 space-y-3">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-10 w-36" />
              </div>
            </div>

            <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <Skeleton className="h-5 w-32" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="space-y-1.5">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Hovedkolonnen: beskrivelse, sjekklister og rapporter. */}
          <div className="space-y-6 lg:col-span-2 lg:col-start-1 lg:row-start-1">
            <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <Skeleton className="h-6 w-48" />
              <div className="mt-4 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>

            <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <Skeleton className="h-6 w-44" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="rounded-xl border-2 border-gray-100 bg-gray-50 p-4"
                  >
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="mt-2 h-3 w-1/3" />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <Skeleton className="h-6 w-36" />
              <div className="mt-4 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <span className="sr-only">{t("components.loading")}</span>
    </div>
  );
}
