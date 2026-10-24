import type { ReactNode } from "react";

/** Tom tilstand med en tydelig handling, i stedet for en tom liste. */
export default function EmptyState({
  icon = "📭",
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <div className="text-3xl" aria-hidden="true">
        {icon}
      </div>
      <h2 className="mt-3 text-base font-bold text-gray-900">{title}</h2>
      {description && (
        <p className="mt-1 max-w-md text-sm text-gray-600">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
