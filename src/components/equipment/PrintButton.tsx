"use client";

import { useTranslations } from "next-intl";
import Icon from "@/components/icons";

/** Utskrift av A6-etiketten. Skjules når siden selv skrives ut. */
export default function PrintButton() {
  const t = useTranslations("common");
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="signal-button inline-flex min-h-11 items-center justify-center gap-1.5 border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-4 text-sm text-[var(--ink,#101310)]"
    >
      <Icon name="file" className="h-4 w-4" />
      {t("assets.label.print")}
    </button>
  );
}
