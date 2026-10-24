"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export default function CopyButton({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const t = useTranslations("common");
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
      {copied
        ? t("components.copy.copied")
        : `📋 ${label ?? t("components.copy.label")}`}
    </button>
  );
}
