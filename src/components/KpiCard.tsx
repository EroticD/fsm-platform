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
 */
export default function KpiCard({
  icon,
  label,
  value,
  sub,
  href,
  tone = "gray",
}: {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  tone?: KpiTone;
}) {
  const body = (
    <>
      <div className="text-xl sm:text-2xl leading-none">{icon}</div>
      <div className="mt-2 text-xl sm:text-2xl font-black leading-none break-words">{value}</div>
      <div className="mt-1.5 text-[10px] sm:text-[11px] font-bold uppercase tracking-wide">{label}</div>
      {sub ? <div className="mt-0.5 text-[11px] font-medium truncate">{sub}</div> : null}
    </>
  );

  const cls = `block rounded-2xl border-2 p-3 sm:p-4 shadow-sm transition ${TONES[tone]}${
    href ? " hover:shadow-md hover:-translate-y-0.5" : ""
  }`;

  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
