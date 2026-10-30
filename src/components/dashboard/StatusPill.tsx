const STATUS_LABEL_KEYS: Record<string, string> = {
  OPEN: "statusOpen",
  PENDING: "statusPending",
  PLANNED: "statusPlanned",
  IN_PROGRESS: "statusInProgress",
  WAITING: "statusWaiting",
  COMPLETED: "statusCompleted",
  CANCELLED: "statusCancelled",
};

const STATUS_TONE: Record<string, string> = {
  IN_PROGRESS:
    "border-[var(--ink,#131711)] bg-[var(--signal,#c8f135)] text-[var(--ink,#131711)]",
  COMPLETED: "border-[#a9c96a] bg-[#eef7d6] text-[#283509]",
  CANCELLED: "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]",
  WAITING: "border-[#e4c98f] bg-[#fdf5e4] text-[#7a4f0c]",
};

export function statusLabel(
  t: (key: string) => string,
  status: string,
): string {
  return t(STATUS_LABEL_KEYS[status] ?? "statusOpen");
}

export default function StatusPill({
  status,
  label,
  className = "",
}: {
  status: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-bold ${
        STATUS_TONE[status] ?? "border-[var(--line,#d8d3c5)] bg-white"
      } ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
