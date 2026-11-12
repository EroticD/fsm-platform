"use client";

import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { registryStatusIsRisk } from "@/lib/customer-registry-status";

/**
 * Viser registerstatus fra Enhetsregisteret når den avviker fra det normale.
 *
 * `ACTIVE` og `UNKNOWN` vises ikke: det første er forventet, og det andre betyr
 * bare at vakten ikke har fått svar ennå. Merket er informativt, ikke en sperre —
 * kunden kan fortsatt brukes selv om den er under avvikling.
 */
export default function RegistryStatusBadge({
  status,
  checkedAt,
}: {
  status?: string | null;
  checkedAt?: Date | string | null;
}) {
  const t = useTranslations("common");

  if (!status || status === "ACTIVE" || status === "UNKNOWN") return null;

  const label =
    status === "BANKRUPT"
      ? t("customers.registry.bankrupt")
      : status === "UNDER_LIQUIDATION"
        ? t("customers.registry.underLiquidation")
        : status === "NOT_FOUND"
          ? t("customers.registry.notFound")
          : // Ukjente statuser skal ikke skjules helt: da ser vi at vakten
            // har skrevet noe vi ikke kjenner, uten å påstå hva det betyr.
            t("customers.registry.unknown");

  const risky = registryStatusIsRisk(status);
  const checked = checkedAt ? new Date(checkedAt) : null;
  const title =
    checked && !Number.isNaN(checked.getTime())
      ? t("customers.registry.checked", {
          date: checked.toLocaleDateString("nb-NO"),
        })
      : undefined;

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
        risky
          ? "border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]"
          : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]"
      }`}
    >
      <Icon name="alert" className="h-3 w-3 shrink-0" />
      {label}
    </span>
  );
}
