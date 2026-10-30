import Icon, { type IconName } from "@/components/icons";

/**
 * Trykkflate for de tre nøkkeltallene i helten. Ankeret er en vanlig lenke,
 * slik at tastatur og skjermleser får samme oppførsel som en navigasjon.
 */
export default function FieldStatLink({
  href,
  icon,
  value,
  label,
  tone = "default",
}: {
  href: string;
  icon: IconName;
  value: number;
  label: string;
  tone?: "default" | "risk" | "signal";
}) {
  const valueClass =
    tone === "risk"
      ? "text-risk"
      : tone === "signal"
        ? "text-signal"
        : "text-paper";

  return (
    <a
      href={href}
      className="group flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-[#2a3328] bg-white/[0.04] px-2 py-2 text-center transition hover:border-signal/50 hover:bg-white/[0.08]"
    >
      <span
        className={`flex items-center gap-1 text-lg font-black leading-none tabular-nums ${valueClass}`}
      >
        <Icon name={icon} className="h-3.5 w-3.5 opacity-70" />
        {value}
      </span>
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-paper/55">
        {label}
      </span>
    </a>
  );
}
