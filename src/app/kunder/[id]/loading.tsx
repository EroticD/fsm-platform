import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";
import { LEGACY_SURFACE } from "@/components/customer/customerStyles";

/** Skjelett for kundekortet: header, fire nøkkeltall, faner og to paneler. */
export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="office-app min-h-screen p-3 sm:p-6 lg:p-8"
      role="status"
      aria-live="polite"
    >
      <div
        className={`mx-auto max-w-6xl space-y-4 ${LEGACY_SURFACE}`}
        aria-hidden="true"
      >
        <div className="office-card px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-8 w-64 max-w-full" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-11 w-32" />
              <Skeleton className="h-11 w-24" />
              <Skeleton className="h-11 w-28" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="office-card flex items-center gap-2.5 p-2.5 sm:gap-3 sm:p-3"
            >
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-3 w-20 max-w-full" />
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-1 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-1">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-11 w-24 shrink-0 rounded-full" />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <section className="office-card space-y-3 p-4 sm:p-5 lg:col-span-2">
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
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          </section>

          <div className="space-y-4 lg:col-span-3">
            <section className="office-card space-y-3 p-4 sm:p-5">
              <Skeleton className="h-5 w-40" />
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
                >
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </div>
              ))}
            </section>

            <section className="office-card space-y-3 p-4 sm:p-5">
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
