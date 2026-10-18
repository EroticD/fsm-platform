"use client";

import { useState } from "react";

export default function CopyButton({
  value,
  label = "Kopier",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard utilgjengelig – brukeren kan markere teksten manuelt.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-xs font-bold bg-gray-800 text-white px-3 py-2 rounded-lg hover:bg-gray-700 transition whitespace-nowrap"
    >
      {copied ? "✅ Kopiert" : `📋 ${label}`}
    </button>
  );
}
