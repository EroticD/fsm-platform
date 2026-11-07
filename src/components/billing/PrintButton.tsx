"use client";

export default function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-[var(--ink,#101310)] px-4 text-xs font-bold text-[var(--paper,#f2efe6)] print:hidden"
    >
      {label}
    </button>
  );
}
