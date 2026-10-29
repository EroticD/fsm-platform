import Link from "next/link";
import { brandCard } from "@/components/ui/brandStyles";

export type KpiTone = "blue" | "green" | "amber" | "red" | "gray" | "purple";

type ToneStyle = {
  accent: string;
  icon: string;
  sub: string;
};

/**
 * Fargetonen er en aksent, ikke en bakgrunn. Tallet er alltid blekksvart, slik
 * at kortene fremstår som én rolig oversikt selv når et tall krever handling.
 */
const TONES: Record<KpiTone, ToneStyle> = {
  blue: {
    accent: "bg-[var(--ink,#101310)]",
    icon: "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]",
    sub: "text-[var(--muted,#62685f)]",
  },
  green: {
    accent: "bg-[var(--signal,#d8ff3e)]",
    icon: "border-[#c7d98e] bg-[#f3fbd1] text-[var(--ink,#101310)]",
    sub: "text-[#4f5b2d]",
  },
  amber: {
    accent: "bg-[#d97706]",
    icon: "border-[#e9c9a9] bg-[#fbeadb] text-[#8a3511]",
    sub: "text-[#8a3511]",
  },
  red: {
    accent: "bg-[var(--risk,#f04427)]",
    icon: "border-[#e7b7a4] bg-[#fae8e0] text-[#a92a12]",
    sub: "text-[#a92a12]",
  },
  gray: {
    accent: "bg-[var(--line,#dedcd1)]",
    icon: "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]",
    sub: "text-[var(--muted,#62685f)]",
  },
  purple: {
    accent: "bg-[var(--ink,#101310)]",
    icon: "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]",
    sub: "text-[var(--muted,#62685f)]",
  },
};

/**
 * Tallkort brukt på dashbordene. Er `href` satt blir hele kortet en lenke.
 *
 * `compact` brukes til unntaksstripen og sekundære nøkkeltall: et stramt
 * kommandosenter-kort med 12 px etikett, blekksvart tall og en tynn
 * signal-/risikostripe. Fargetonen følger `tone`, også i kompakt modus.
 */
export default function KpiCard({
  icon,
  label,
  value,
  sub,
  href,
  tone = "gray",
  compact = false,
}: {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  tone?: KpiTone;
  compact?: boolean;
}) {
  const style = TONES[tone];

  if (compact) {
    const body = (
      <>
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 w-1 ${style.accent}`}
        />
        <div className="min-w-0 pl-1.5">
          <div className="line-clamp-2 text-xs font-bold uppercase leading-4 tracking-[0.08em] text-[var(--muted,#62685f)]">
            {label}
          </div>
          <div className="mt-1 text-xl font-extrabold leading-none tracking-tight text-[var(--ink,#101310)] tabular-nums">
            {value}
          </div>
          {sub ? (
            <div
              className={`mt-1 line-clamp-2 text-xs font-medium leading-4 ${style.sub}`}
            >
              {sub}
            </div>
          ) : null}
        </div>
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm ${style.icon}`}
          aria-hidden="true"
        >
          {icon}
        </div>
      </>
    );

    const cls = `relative flex min-h-[76px] items-center justify-between gap-2 overflow-hidden px-3 py-2.5 [--focus-ring:var(--ink,#101310)] ${brandCard} ${
      href
        ? "transition hover:-translate-y-0.5 hover:border-[#bdb3a0] hover:shadow-[0_3px_10px_rgba(20,17,11,0.08)]"
        : "cursor-default"
    }`;

    return href ? (
      <Link href={href} className={cls}>
        {body}
      </Link>
    ) : (
      <div className={cls}>{body}</div>
    );
  }

  const body = (
    <>
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-1 ${style.accent}`}
      />
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-lg ${style.icon}`}
          aria-hidden="true"
        >
          {icon}
        </div>
        <span
          aria-hidden="true"
          className={`mt-1 h-2 w-2 rounded-full ${style.accent}`}
        />
      </div>
      <div className="mt-3 text-2xl font-extrabold leading-none tracking-tight text-[var(--ink,#101310)] tabular-nums sm:text-3xl">
        {value}
      </div>
      <div className="mt-1.5 text-xs font-bold uppercase leading-4 tracking-[0.1em] text-[var(--muted,#62685f)]">
        {label}
      </div>
      {sub ? (
        <div className={`mt-0.5 truncate text-xs font-medium ${style.sub}`}>
          {sub}
        </div>
      ) : null}
    </>
  );

  const cls = `office-card relative block overflow-hidden rounded-card border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3 shadow-[0_1px_2px_rgba(20,17,11,0.05)] [--focus-ring:var(--ink,#101310)] sm:p-4 ${
    href
      ? "transition hover:-translate-y-0.5 hover:border-[#bdb3a0] hover:shadow-[0_5px_16px_rgba(20,17,11,0.09)]"
      : "cursor-default"
  }`;

  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
