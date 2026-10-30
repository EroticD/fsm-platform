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
      className="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
    >
      {copied
        ? t("components.copy.copied")
        : (label ?? t("components.copy.label"))}
    </button>
  );
}
