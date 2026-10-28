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
      className="rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm"
    >
      <h2 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-600">
        {title}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {items.map((item) => (
          <li
            key={item.status}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-800"
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full border border-white shadow-sm"
              style={{ backgroundColor: workOrderStatusColor(item.status) }}
            />
            <span>{item.label}</span>
            {typeof item.count === "number" && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 font-bold text-gray-700">
                {item.count}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
