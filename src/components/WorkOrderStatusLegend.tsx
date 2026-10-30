import { workOrderStatusColor } from "@/lib/work-order-status-colors";

export type WorkOrderStatusLegendItem = {
  status: string;
  label: string;
  count?: number;
};

/**
 * Forklaring på statusfargene. Brukes både i kalenderen og på kartet, slik at
 * fargene er dokumentert der de faktisk dukker opp.
 */
export default function WorkOrderStatusLegend({
  title,
  items,
}: {
  title: string;
  items: WorkOrderStatusLegendItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section
      aria-label={title}
      className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2"
    >
      <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {items.map((item) => (
          <li
            key={item.status}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink,#101310)]"
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full border border-[var(--surface,#fffdf8)]"
              style={{ backgroundColor: workOrderStatusColor(item.status) }}
            />
            <span>{item.label}</span>
            {typeof item.count === "number" && (
              <span className="rounded bg-[var(--paper,#f2efe6)] px-1.5 py-0.5 font-bold text-[var(--ink,#101310)]">
                {item.count}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
