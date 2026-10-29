import Link from "next/link";

export type KpiTone = "blue" | "green" | "amber" | "red" | "gray" | "purple";

const TONES: Record<KpiTone, string> = {
  blue: "border-blue-200 bg-blue-50 text-blue-900",
  green: "border-green-200 bg-green-50 text-green-900",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  red: "border-red-200 bg-red-50 text-red-900",
  gray: "border-gray-200 bg-white text-gray-900",
  purple: "border-purple-200 bg-purple-50 text-purple-900",
};

/**
 * Tallkort brukt på dashbordene. Er `href` satt blir hele kortet en lenke.
 *
 * `compact` brukes til unntaksstripen og sekundære nøkkeltall: mindre kort
 * uten heveeffekt, slik at de ikke konkurrerer med den prioriterte køen.
 * Fargetonen følger `tone`, også i kompakt modus.
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
  if (compact) {
    const body = (
      <>
        <div className="min-w-0">
          <div className="line-clamp-2 text-2xs font-bold uppercase leading-tight tracking-wide">
            {label}
          </div>
          <div className="mt-0.5 text-xl font-black leading-tight">
            {value}
          </div>
          {sub ? (
            <div className="line-clamp-2 text-2xs font-medium leading-tight opacity-80">
              {sub}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-base" aria-hidden="true">
          {icon}
        </div>
      </>
    );

    const cls = `flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 transition-shadow ${TONES[tone]} ${
      href ? "shadow-sm hover:shadow-md" : "cursor-default"
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
      <div className="text-xl sm:text-2xl leading-none" aria-hidden="true">
        {icon}
      </div>
      <div className="mt-2 text-xl sm:text-2xl font-black leading-none break-words">
        {value}
      </div>
      <div className="mt-1.5 text-xs font-bold uppercase tracking-wide">{label}</div>
      {sub ? <div className="mt-0.5 text-xs font-medium truncate">{sub}</div> : null}
    </>
  );

  const cls = `block rounded-2xl border-2 p-3 sm:p-4 ${
    href
      ? "shadow-sm transition hover:shadow-md hover:-translate-y-0.5"
      : "cursor-default shadow-none"
  } ${TONES[tone]}`;

  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
