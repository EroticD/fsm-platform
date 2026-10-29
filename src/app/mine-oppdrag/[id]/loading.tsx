import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";

/** Skjelett for feltdetaljen: header, status/dato, sjekkliste og fast bunnknapp. */
export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="min-h-screen bg-field p-4 pb-48 text-paper sm:p-6 sm:pb-10"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-3xl space-y-5" aria-hidden="true">
        <div className="rounded-[1.75rem] border border-[#2a3328] bg-field-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-6 w-32 bg-white/10" />
            <Skeleton className="h-11 w-24 bg-white/10" />
          </div>
          <div className="mt-4 space-y-2">
            <Skeleton className="h-8 w-64 max-w-full bg-white/10" />
            <Skeleton className="h-4 w-52 max-w-full bg-white/[0.07]" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Skeleton className="h-6 w-28 rounded-full bg-white/10" />
            <Skeleton className="h-6 w-32 rounded-full bg-white/10" />
            <Skeleton className="h-6 w-24 rounded-full bg-white/10" />
          </div>
        </div>

        <div className="rounded-2xl border border-[#2a3328] bg-field-card p-4 shadow-sm sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
            <div className="space-y-2">
              <Skeleton className="h-3 w-20 bg-white/10" />
              <Skeleton className="h-11 w-full bg-field" />
              <Skeleton className="h-10 w-32 bg-white/10" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-24 bg-white/10" />
              <Skeleton className="h-11 w-full bg-field" />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#2a3328] bg-field-card p-4 shadow-sm sm:p-5">
          <Skeleton className="h-3 w-28 bg-white/10" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Skeleton className="h-12 w-28 bg-white/10" />
            <Skeleton className="h-12 w-24 bg-white/10" />
            <Skeleton className="h-12 w-24 bg-white/10" />
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 bg-paper p-4 shadow-[0_18px_40px_rgba(0,0,0,0.18)] sm:p-6">
          <Skeleton className="h-6 w-40" />
          <div className="mt-4 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>

          <div className="mt-5 space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white/50 p-3 sm:p-4"
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
      </div>

      {/* Fast handling på mobil, som på den ekte feltsiden. */}
      <div
        aria-hidden="true"
        className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-40 border-t border-[#2a3328] bg-field/95 p-3 shadow-[0_-8px_24px_rgba(0,0,0,0.28)] backdrop-blur sm:hidden"
      >
        <div className="mx-auto max-w-3xl">
          <Skeleton className="h-14 w-full rounded-2xl bg-signal" />
        </div>
      </div>

      <span className="sr-only">{t("components.loading")}</span>
    </div>
  );
}
