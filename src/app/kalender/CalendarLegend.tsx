import { workOrderStatusColor } from "@/lib/work-order-status-colors";

export type CalendarLegendItem = {
  status: string;
  label: string;
  count?: number;
};

/**
 * Statusforklaring på kalenderflatene. Fargene er de samme som i
 * FullCalendar og på kartet, men flaten bruker papir/ink i stedet for de
 * gamle grå boksene.
 */
export default function CalendarLegend({
  title,
  items,
}: {
  title: string;
  items: CalendarLegendItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section
      aria-label={title}
      className="office-card flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {items.map((item) => (
          <li
            key={item.status}
            className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink,#101310)]"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: workOrderStatusColor(item.status) }}
            />
            <span>{item.label}</span>
            {typeof item.count === "number" ? (
              <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-1.5 py-0.5 text-xs font-bold tabular-nums text-[var(--ink,#101310)]">
                {item.count}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
