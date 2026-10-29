import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";

/** Skjelett for kundekortet: header, fire nøkkeltall, faner og to paneler. */
export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-5xl space-y-6" aria-hidden="true">
        <div className="flex flex-col gap-3 border-b border-gray-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-28" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-2.5 rounded-2xl border-2 border-gray-200 bg-white p-3 shadow-sm sm:gap-3"
            >
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-3 w-20 max-w-full" />
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 overflow-hidden border-b border-gray-200 pb-1">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton
              key={index}
              className="h-11 w-24 shrink-0 rounded-xl"
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <section className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6 lg:col-span-2">
            <Skeleton className="h-5 w-36" />
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </section>

          <div className="space-y-4 lg:col-span-3">
            <section className="space-y-3 rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <Skeleton className="h-5 w-40" />
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-gray-100 bg-gray-50 p-3"
                >
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </div>
              ))}
            </section>

            <section className="space-y-3 rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <Skeleton className="h-5 w-36" />
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-4 w-full" />
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>

      <span className="sr-only">{t("components.loading")}</span>
    </div>
  );
}
