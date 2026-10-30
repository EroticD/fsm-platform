import { getTranslations } from "next-intl/server";

function Bar({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-[var(--line,#dedcd1)] ${className}`}
    />
  );
}

export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="office-app min-h-screen p-3 sm:p-6 lg:p-8"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="office-card px-5 py-5 sm:px-6">
          <div className="space-y-2">
            <Bar className="h-8 w-52" />
            <Bar className="h-4 w-72 max-w-full" />
          </div>
        </div>

        <div className="office-card space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Bar key={index} className="h-8 w-28" />
            ))}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[var(--line,#dedcd1)] pt-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Bar key={index} className="h-8 w-24" />
            ))}
          </div>
          <div className="grid gap-2 border-t border-[var(--line,#dedcd1)] pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Bar className="h-10 sm:col-span-2 lg:col-span-4" />
            <Bar className="h-10" />
            <Bar className="h-10" />
            <Bar className="h-10" />
            <Bar className="h-10" />
          </div>
        </div>

        <div className="office-card overflow-hidden">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="space-y-2 border-b border-[var(--line,#dedcd1)] p-3 last:border-0"
            >
              <Bar className="h-4 w-1/3" />
              <Bar className="h-3 w-3/4" />
            </div>
          ))}
        </div>

        <span className="sr-only">{t("components.loading")}</span>
      </div>
    </div>
  );
}
