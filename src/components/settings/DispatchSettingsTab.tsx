import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import type {
  DispatchPolicyView,
  TerritoryView,
} from "@/server/dispatch";

type Department = { id: string; name: string; isDefault: boolean };

type Props = {
  policies: DispatchPolicyView[];
  territories: TerritoryView[];
  departments: Department[];
  departmentId: string;
  error?: string;
  ok?: string;
  savePolicy: (formData: FormData) => Promise<void>;
  saveTerritory: (formData: FormData) => Promise<void>;
  deleteTerritory: (formData: FormData) => Promise<void>;
};

const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm text-[var(--ink,#101310)]";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]";
const CARD = "office-card space-y-4 p-4 sm:p-5";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)] transition hover:opacity-85";
const WEIGHTS = [
  "skills",
  "distance",
  "travel",
  "free",
  "sla",
  "load",
] as const;

export default async function DispatchSettingsTab({
  policies,
  territories,
  departments,
  departmentId,
  error,
  ok,
  savePolicy,
  saveTerritory,
  deleteTerritory,
}: Props) {
  const t = await getTranslations("common");
  const policy = policies[0] ?? null;

  return (
    <div className="space-y-5">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t("settings.dispatch.error")}
        </div>
      ) : null}
      {ok ? (
        <div className="rounded-xl border border-[#bcd39a] bg-[#eef7d6] p-3 text-sm font-bold text-[#283509]">
          {t("settings.dispatch.saved")}
        </div>
      ) : null}

      <section aria-labelledby="dispatch-policy-title" className={CARD}>
        <div>
          <h2
            id="dispatch-policy-title"
            className="flex items-center gap-2 text-base font-black text-[var(--ink,#101310)]"
          >
            <Icon name="route" className="h-4 w-4" />
            {t("settings.dispatch.policyTitle")}
          </h2>
          <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
            {t("settings.dispatch.policyHint")}
          </p>
        </div>

        <form action={savePolicy} className="space-y-4">
          <input type="hidden" name="id" value={policy?.id ?? ""} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={LABEL}>{t("settings.dispatch.department")}</span>
              <select
                name="departmentId"
                defaultValue={policy?.departmentId ?? departmentId}
                className={INPUT}
                required
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>{t("settings.dispatch.mode")}</span>
              <select
                name="mode"
                defaultValue={policy?.mode ?? "SKILLS"}
                className={INPUT}
              >
                <option value="SKILLS">
                  {t("settings.dispatch.modes.skills")}
                </option>
                <option value="DISTANCE">
                  {t("settings.dispatch.modes.distance")}
                </option>
                <option value="EARLIEST">
                  {t("settings.dispatch.modes.earliest")}
                </option>
                <option value="CUSTOM">
                  {t("settings.dispatch.modes.custom")}
                </option>
              </select>
            </label>
          </div>

          <fieldset>
            <legend className={LABEL}>
              {t("settings.dispatch.weights")}
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {WEIGHTS.map((key) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-[11px] font-bold text-[var(--muted,#62685f)]">
                    {t(`settings.dispatch.weightLabels.${key}`)}
                  </span>
                  <input
                    type="number"
                    name={`weight${key.charAt(0).toUpperCase()}${key.slice(1)}`}
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={policy?.weights[key] ?? 10}
                    className={INPUT}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit" className={BUTTON}>
            <Icon name="check" className="h-4 w-4" />
            {t("settings.dispatch.savePolicy")}
          </button>
        </form>
      </section>

      <section aria-labelledby="dispatch-territories-title" className={CARD}>
        <div>
          <h2
            id="dispatch-territories-title"
            className="flex items-center gap-2 text-base font-black text-[var(--ink,#101310)]"
          >
            <Icon name="pin" className="h-4 w-4" />
            {t("settings.dispatch.territoryTitle")}
          </h2>
          <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
            {t("settings.dispatch.territoryHint")}
          </p>
        </div>

        {territories.length > 0 ? (
          <ul className="space-y-2">
            {territories.map((territory) => (
              <li
                key={territory.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--ink,#101310)]">
                    {territory.name}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted,#62685f)]">
                    {t("settings.dispatch.territorySummary", {
                      postal: territory.postalPrefixes.join(", ") || "–",
                      municipalities:
                        territory.municipalityCodes.join(", ") || "–",
                      radius: territory.radiusKm ?? "–",
                    })}
                  </p>
                </div>
                <form action={deleteTerritory}>
                  <input type="hidden" name="id" value={territory.id} />
                  <input
                    type="hidden"
                    name="departmentId"
                    value={territory.departmentId}
                  />
                  <button
                    type="submit"
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#e7b5ae] bg-white px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#fdf4f2]"
                  >
                    {t("settings.dispatch.deleteTerritory")}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm italic text-[var(--muted,#62685f)]">
            {t("settings.dispatch.noTerritories")}
          </p>
        )}

        <form action={saveTerritory} className="space-y-3 border-t border-[var(--line,#dedcd1)] pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={LABEL}>{t("settings.dispatch.department")}</span>
              <select
                name="departmentId"
                defaultValue={departmentId}
                className={INPUT}
                required
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={LABEL}>{t("settings.dispatch.territoryName")}</span>
              <input name="name" required maxLength={120} className={INPUT} />
            </label>
            <label className="block">
              <span className={LABEL}>
                {t("settings.dispatch.postalPrefixes")}
              </span>
              <input
                name="postalPrefixes"
                placeholder={t("settings.dispatch.postalPrefixesPlaceholder")}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className={LABEL}>
                {t("settings.dispatch.municipalityCodes")}
              </span>
              <input
                name="municipalityCodes"
                placeholder={t("settings.dispatch.municipalityCodesPlaceholder")}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className={LABEL}>{t("settings.dispatch.radiusKm")}</span>
              <input
                type="number"
                name="radiusKm"
                min={0}
                max={500}
                step={1}
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className={LABEL}>{t("settings.dispatch.center")}</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  name="centerLat"
                  min={-90}
                  max={90}
                  step="0.000001"
                  placeholder={t("settings.dispatch.latitude")}
                  className={INPUT}
                />
                <input
                  type="number"
                  name="centerLng"
                  min={-180}
                  max={180}
                  step="0.000001"
                  placeholder={t("settings.dispatch.longitude")}
                  className={INPUT}
                />
              </div>
            </label>
          </div>
          <button type="submit" className={BUTTON}>
            <Icon name="plus" className="h-4 w-4" />
            {t("settings.dispatch.saveTerritory")}
          </button>
        </form>
      </section>
    </div>
  );
}
