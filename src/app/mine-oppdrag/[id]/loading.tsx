import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";

/** Skjelett for feltdetaljen: header, status/dato, sjekkliste og fast bunnknapp. */
export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="min-h-screen bg-gray-50 p-4 pb-28 sm:p-6 sm:pb-6"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-3xl space-y-6" aria-hidden="true">
        <div className="flex items-start justify-between gap-3 border-b border-gray-300 pb-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-52 max-w-full" />
            <Skeleton className="h-3 w-40 max-w-full" />
            <div className="flex flex-wrap gap-2 pt-1">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-11 w-24 shrink-0" />
        </div>

        <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-10 w-32" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-11 w-full" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-blue-200 bg-white p-4 shadow-sm sm:p-6">
          <Skeleton className="h-6 w-40" />
          <div className="mt-4 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>

          <div className="mt-5 space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-gray-100 bg-gray-50 p-3 sm:p-4"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-10 w-24" />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <Skeleton className="h-3 w-28" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Skeleton className="h-11 w-28" />
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-11 w-24" />
          </div>
        </div>
      </div>

      {/* Fast handling på mobil, som på den ekte feltsiden. */}
      <div
        aria-hidden="true"
        className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-gray-200 bg-white/95 p-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur sm:hidden"
      >
        <div className="mx-auto max-w-3xl">
          <Skeleton className="h-12 w-full" />
        </div>
      </div>

      <span className="sr-only">{t("components.loading")}</span>
    </div>
  );
}
