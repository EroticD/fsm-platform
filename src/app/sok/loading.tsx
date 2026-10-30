import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";

function LoadingCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="office-card p-5">
      <Skeleton className="h-4 w-1/3" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton
            key={index}
            className={index === lines - 1 ? "h-3 w-2/3" : "h-3 w-full"}
          />
        ))}
      </div>
    </div>
  );
}

export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="min-h-screen bg-[var(--canvas,#f4f5f2)] px-3 py-4 sm:px-6 sm:py-6 lg:px-8"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="office-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
          <Skeleton className="h-12 w-32 shrink-0" />
          <div className="flex min-w-0 flex-1 gap-2">
            <Skeleton className="h-12 flex-1" />
            <Skeleton className="h-12 w-24 shrink-0" />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="hidden space-y-4 lg:block">
            <LoadingCard lines={4} />
            <LoadingCard lines={3} />
          </aside>

          <div className="min-w-0 space-y-5">
            <div className="space-y-3 office-card p-5">
              <Skeleton className="h-6 w-56 max-w-full" />
              <Skeleton className="h-3 w-36" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <LoadingCard key={index} lines={2} />
              ))}
            </div>
          </div>
        </div>

        <span className="sr-only">{t("components.loading")}</span>
      </div>
    </div>
  );
}
