"use client";

import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import type { ModuleKey } from "@/lib/modules";

export type ModuleRowView = {
  key: ModuleKey;
  enabled: boolean;
  core: boolean;
  status: "active" | "planned";
  dependencies: ModuleKey[];
  dependents: ModuleKey[];
  missingDependencies: ModuleKey[];
  enabledDependents: ModuleKey[];
};

type ModulesTabProps = {
  modules: ModuleRowView[];
  labels: Record<string, { label: string; description: string }>;
  action: (formData: FormData) => void | Promise<void>;
  error?: string;
  ok?: boolean;
  canManage: boolean;
};

/**
 * Administrasjon av installasjonsnivåmoduler.
 *
 * Knappene er ekte skjemaer mot en server action som revideres. Vi deaktiverer
 * bare kombinasjoner som avhengighetsreglene ville avvist, slik at brukeren
 * aldri får en død lenke eller en handling som feiler uten forklaring.
 */
export default function ModulesTab({
  modules,
  labels,
  action,
  error,
  ok,
  canManage,
}: ModulesTabProps) {
  const t = useTranslations("common");

  return (
    <div className="space-y-4">
      <section className="office-card p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
          <Icon name="grid" className="h-4 w-4 shrink-0" />
          {t("settings.modules.title")}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted,#62685f)]">
          {t("settings.modules.description")}
        </p>
        <p className="mt-3 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]">
          {t("settings.modules.dataPreserved")}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
            {t(`settings.modules.errors.${error}`)}
          </p>
        )}
        {ok && (
          <p role="status" className="mt-3 text-sm font-bold text-[var(--ink,#101310)]">
            {t("settings.modules.saved")}
          </p>
        )}
      </section>

      <ul className="space-y-2">
        {modules.map((module) => {
          const label = labels[module.key]?.label ?? module.key;
          const description = labels[module.key]?.description ?? "";
          const dependsOn = module.dependencies
            .map((key) => labels[key]?.label ?? key)
            .join(", ");
          const requiredBy = module.dependents
            .map((key) => labels[key]?.label ?? key)
            .join(", ");
          const blockedByDependencies =
            !module.enabled && module.missingDependencies.length > 0;
          const blockedByDependents =
            module.enabled && module.enabledDependents.length > 0;
          const blocked = module.core || !canManage;
          const nextEnabled = !module.enabled;

          return (
            <li
              key={module.key}
              className="office-card flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
                    {label}
                  </h3>
                  {module.core && (
                    <span className="rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em]">
                      {t("settings.modules.core")}
                    </span>
                  )}
                  {module.status === "planned" && (
                    <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em]">
                      {t("settings.modules.planned")}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] ${
                      module.enabled
                        ? "bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                        : "border border-[var(--line,#dedcd1)] text-[var(--muted,#62685f)]"
                    }`}
                  >
                    {module.enabled
                      ? t("settings.modules.enabled")
                      : t("settings.modules.disabled")}
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--muted,#62685f)]">
                  {description}
                </p>
                {module.dependencies.length > 0 && (
                  <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
                    {t("settings.modules.dependsOn", { modules: dependsOn })}
                  </p>
                )}
                {module.dependents.length > 0 && (
                  <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
                    {t("settings.modules.requiredBy", { modules: requiredBy })}
                  </p>
                )}
                {blockedByDependencies && (
                  <p className="mt-2 text-xs font-bold text-[var(--risk-text,#b42318)]">
                    {t("settings.modules.missingDependencies", {
                      modules: module.missingDependencies
                        .map((key) => labels[key]?.label ?? key)
                        .join(", "),
                    })}
                  </p>
                )}
                {blockedByDependents && (
                  <p className="mt-2 text-xs font-bold text-[var(--risk-text,#b42318)]">
                    {t("settings.modules.hasDependents", {
                      modules: module.enabledDependents
                        .map((key) => labels[key]?.label ?? key)
                        .join(", "),
                    })}
                  </p>
                )}
                {module.core && (
                  <p className="mt-2 text-xs text-[var(--muted,#62685f)]">
                    {t("settings.modules.coreLocked")}
                  </p>
                )}
              </div>

              <form
                action={action}
                className="shrink-0"
                onSubmit={(event) => {
                  if (blocked || blockedByDependencies || blockedByDependents) {
                    event.preventDefault();
                    return;
                  }
                  const message = module.enabled
                    ? t("settings.modules.confirmDisable", { module: label })
                    : t("settings.modules.confirmEnable", { module: label });
                  if (!window.confirm(message)) event.preventDefault();
                }}
              >
                <input type="hidden" name="key" value={module.key} />
                <input
                  type="hidden"
                  name="enabled"
                  value={nextEnabled ? "true" : "false"}
                />
                <button
                  type="submit"
                  disabled={
                    blocked || blockedByDependencies || blockedByDependents
                  }
                  className={`inline-flex min-h-10 items-center justify-center rounded-[10px] border px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    module.enabled
                      ? "border-[var(--line,#dedcd1)] text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)]"
                      : "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                  }`}
                >
                  {module.enabled
                    ? t("settings.modules.disable")
                    : t("settings.modules.enable")}
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
