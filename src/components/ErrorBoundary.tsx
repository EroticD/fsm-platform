"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import Icon from "@/components/icons";

export default function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const t = useTranslations("common");
  const [error, setError] = useState<Error | null>(null);

  if (error) {
    return (
      <div className="office-app flex min-h-screen items-center justify-center p-8">
        <div className="office-card w-full max-w-md p-8 text-center [--focus-ring:var(--ink,#101310)]">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)]">
            <Icon name="alert" className="h-6 w-6" strokeWidth={2} />
          </span>
          <h2 className="mb-2 text-2xl font-black text-[var(--ink,#101310)]">{t("components.error.title")}</h2>
          <p className="mb-4 text-sm text-[var(--muted,#62685f)]">{error.message || t("components.error.fallback")}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            className="ink-button px-5 text-sm"
          >
            {t("components.error.retry")}
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
