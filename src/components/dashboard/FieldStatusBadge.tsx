import {
  FIELD_STATUS_LABEL_KEYS,
  type FieldStatusKey,
} from "@/lib/dashboard-field-status";

type Translator = (key: string, values?: Record<string, string | number>) => string;

const STATUS_STYLES: Record<FieldStatusKey, string> = {
  ON_SITE:
    "bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)] ring-[var(--ink,#101310)]/15",
  EN_ROUTE: "bg-[#eef4cf] text-[#3f4a1a] ring-[#3f4a1a]/15",
  ASSIGNED: "bg-[#ece9dc] text-[#4a4b40] ring-[#4a4b40]/15",
  DONE: "bg-[#e2efe4] text-[#1f5b2b] ring-[#1f5b2b]/15",
  ABSENT: "bg-[#fbe4df] text-[#8a2c1f] ring-[#8a2c1f]/15",
  AVAILABLE: "bg-[#f1f2ec] text-[#5e6356] ring-[#5e6356]/15",
};

/** Liten statuspill for feltstatus. */
export default function FieldStatusBadge({
  status,
  t,
}: {
  status: FieldStatusKey;
  t: Translator;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] ring-1 ${STATUS_STYLES[status]}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {t(FIELD_STATUS_LABEL_KEYS[status])}
    </span>
  );
}
