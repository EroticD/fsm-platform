import { getTranslations } from "next-intl/server";

function Bar({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-[var(--line,#dedcd1)] ${className}`}
    />
  );
}

/** Skjelett for rapportviseren: papirheader og PDF-ramme under. */
export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-[var(--canvas,#f4f5f2)]"
      role="status"
      aria-live="polite"
    >
      <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col">
        <div className="relative shrink-0 border-b border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)]">
          <span className="absolute inset-x-0 top-0 h-1 bg-[var(--signal,#d8ff3e)]" />
          <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Bar className="h-9 w-9 rounded-full bg-[var(--paper,#f2efe6)]" />
                <Bar className="h-5 w-56 max-w-full" />
                <Bar className="h-5 w-20 rounded-full bg-[var(--paper,#f2efe6)]" />
              </div>
              <Bar className="h-3 w-72 max-w-full" />
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Bar className="h-5 w-20 rounded-full bg-[var(--paper,#f2efe6)]" />
                <Bar className="h-5 w-28 rounded-full bg-[var(--paper,#f2efe6)]" />
                <Bar className="h-5 w-24 rounded-full bg-[var(--paper,#f2efe6)]" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Bar className="h-10 w-28" />
              <Bar className="h-10 w-24" />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-1.5 sm:p-3">
          <div className="mx-auto flex min-h-[18rem] w-full flex-1 flex-col rounded-lg border border-[var(--line,#dedcd1)] bg-white p-6 shadow-sm sm:p-10">
            <div className="space-y-3">
              <Bar className="h-6 w-1/2" />
              <Bar className="h-4 w-1/3" />
            </div>
            <div className="mt-8 space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="space-y-1.5">
                  <Bar className="h-3 w-full" />
                  <Bar className="h-3 w-11/12" />
                  <Bar className="h-3 w-3/4" />
                </div>
              ))}
            </div>
            <div className="mt-auto grid grid-cols-1 gap-4 pt-10 sm:grid-cols-2">
              <Bar className="h-16 w-full" />
              <Bar className="h-16 w-full" />
            </div>
          </div>
        </div>
      </div>

      <span className="sr-only">{t("components.loading")}</span>
    </div>
  );
}
