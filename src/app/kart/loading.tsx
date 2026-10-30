import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";

/** Skjelett for kartvisningen: header, filterrad, tegnforklaring og kartblokk. */
export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="office-app mx-auto min-h-screen max-w-4xl space-y-5 p-4 sm:p-6"
      role="status"
      aria-live="polite"
    >
      <div className="space-y-5" aria-hidden="true">
        <div className="flex flex-col gap-3 border-b border-[var(--line,#dedcd1)] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-48 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-11 w-32" />
        </div>

        {/* Filterrad */}
        <div className="office-card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-11 w-full" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-11 w-full" />
          </div>
          <div className="space-y-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-11 w-full" />
          </div>
          <Skeleton className="h-11 self-end" />
          <Skeleton className="h-11 self-end" />
        </div>

        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>

        <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-6 w-24 rounded-full" />
          ))}
        </div>

        {/* Kartblokk */}
        <section className="office-card space-y-2 p-3 sm:p-4">
          <Skeleton className="h-72 w-full rounded-xl sm:h-96" />
          <Skeleton className="h-3 w-2/3" />
        </section>

        <div className="space-y-4">
          <div className="office-card p-5">
            <Skeleton className="h-5 w-40" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <span className="sr-only">{t("components.loading")}</span>
    </div>
  );
}
