import { getTranslations } from "next-intl/server";

/** Enkel pulserende plassholder for lasting. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-gray-200 ${className}`}
    />
  );
}

/** Et kort med noen linjer, for lister og detaljsider. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
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

export default async function SkeletonList({ count = 5 }: { count?: number }) {
  const t = await getTranslations("common");

  return (
    <div className="space-y-3" role="status" aria-label={t("components.skeleton.loading")}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} lines={2} />
      ))}
    </div>
  );
}
