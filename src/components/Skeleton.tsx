/** Enkel pulserende plassholder for lasting. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-[var(--line,#dedcd1)] ${className}`}
    />
  );
}

/** Et kort med noen linjer, for lister og detaljsider. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-5">
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

/**
 * Presentasjonell liste med skjeletter. Live-regionen eies av siden eller
 * `loading.tsx` rundt, slik at skjermlesere bare får én annonsering.
 */
export default function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} lines={2} />
      ))}
    </div>
  );
}
