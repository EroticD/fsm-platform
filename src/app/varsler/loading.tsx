import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";

export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="mx-auto min-h-screen max-w-3xl space-y-5 p-4 sm:p-6"
      role="status"
      aria-live="polite"
    >
      <div className="office-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56 max-w-full" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-28" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>

      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="office-card p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-16 shrink-0" />
            </div>
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-3/4" />
          </div>
        ))}
      </div>

      <span className="sr-only">{t("components.loading")}</span>
    </div>
  );
}
