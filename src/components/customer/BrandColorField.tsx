"use client";

import { useState } from "react";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FALLBACK_COLOR = "#2563eb";

/**
 * Fargevelger og tekstfelt som holder samme verdi. Det synlige tekstfeltet er
 * det som sendes med skjemaet, slik at en gyldig hex-kode alltid lagres.
 */
export default function BrandColorField({
  id,
  label,
  defaultValue,
}: {
  id: string;
  label: string;
  defaultValue?: string | null;
}) {
  const [value, setValue] = useState(defaultValue || FALLBACK_COLOR);
  const pickerValue = HEX_COLOR.test(value) ? value : FALLBACK_COLOR;

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={pickerValue}
        onChange={(event) => setValue(event.target.value)}
        aria-label={label}
        className="h-11 w-12 shrink-0 cursor-pointer rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-1"
      />
      <input
        id={id}
        type="text"
        name="brandColor"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={20}
        spellCheck={false}
        aria-label={label}
        className="min-w-0 flex-1 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 font-mono text-sm font-medium text-[var(--ink,#101310)] outline-none transition focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
      />
    </div>
  );
}
