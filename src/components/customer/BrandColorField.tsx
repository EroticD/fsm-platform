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
    <div className="flex gap-3 items-center">
      <input
        type="color"
        value={pickerValue}
        onChange={(event) => setValue(event.target.value)}
        aria-label={label}
        className="w-12 h-12 p-1 rounded cursor-pointer border border-gray-300"
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
        className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium bg-gray-50"
      />
    </div>
  );
}
