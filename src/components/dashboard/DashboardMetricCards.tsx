import Link from "next/link";
import Icon, { type IconName } from "@/components/icons";

export type DashboardMetricCard = {
  key: string;
  label: string;
  value: number;
  foot: string;
  href: string;
  tone: "ink" | "signal" | "paper";
  icon?: IconName;
  marker?: "risk" | "signal" | "ink";
};

const CARD_TONE: Record<DashboardMetricCard["tone"], string> = {
  ink: "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]",
  signal:
    "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
  paper:
    "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)]",
};

const MARKER_TONE: Record<
  NonNullable<DashboardMetricCard["marker"]>,
  string
> = {
  risk: "bg-[var(--risk,#f04427)]",
  signal: "bg-[var(--signal,#d8ff3e)]",
  ink: "bg-[var(--ink,#101310)]",
};

export default function DashboardMetricCards({
  cards,
  title,
}: {
  cards: DashboardMetricCard[];
  title: string;
}) {
  return (
    <section aria-labelledby="dashboard-exceptions-title">
      <h2 id="dashboard-exceptions-title" className="sr-only">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.key}
            href={card.href}
            className={`group relative flex min-h-[8.75rem] flex-col overflow-hidden rounded-2xl border p-4 shadow-[0_10px_28px_-22px_rgba(16,19,16,0.4)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_-22px_rgba(16,19,16,0.45)] ${CARD_TONE[card.tone]}`}
          >
            {card.tone === "ink" ? (
              <span
                aria-hidden
                className="absolute -right-3 top-1 h-20 w-1.5 rotate-45 bg-[var(--risk,#f04427)]"
              />
            ) : null}
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-black uppercase tracking-[0.14em]">
                {card.label}
              </span>
              {card.marker ? (
                <span
                  aria-hidden
                  className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-[#101310]/25 ${MARKER_TONE[card.marker]}`}
                />
              ) : card.icon ? (
                <span
                  aria-hidden
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                    card.tone === "ink"
                      ? "border-[#f2efe6]/40 text-current"
                      : "border-[#101310]/25 text-current"
                  }`}
                >
                  <Icon name={card.icon} className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </div>
            <span className="mt-2 block text-5xl font-black leading-none tracking-[-0.05em] tabular-nums sm:text-6xl">
              {card.value}
            </span>
            <span
              className={`mt-auto block pt-3 text-xs font-bold ${
                card.tone === "ink"
                  ? "text-[var(--paper,#f2efe6)]/80"
                  : "text-[var(--muted,#62685f)]"
              }`}
            >
              {card.foot}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
