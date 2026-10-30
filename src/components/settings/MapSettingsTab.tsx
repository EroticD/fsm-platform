import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import type { MapLayer, MapProvider, MapSettingsView } from "@/server/map-settings";

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const LABEL =
  "block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";

/**
 * Globale kartinnstillinger. API-nøkkelen sendes aldri tilbake til nettleseren
 * etter lagring; feltet er tomt og viser bare om en nøkkel allerede finnes.
 */
export default async function MapSettingsTab({
  settings,
  error,
  saved,
  action,
}: {
  settings: MapSettingsView;
  error?: string;
  saved?: boolean;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const t = await getTranslations("common");
  const providers: Array<{ value: MapProvider; label: string }> = [
    { value: "osm", label: t("settings.map.providers.osm") },
    { value: "maptiler", label: t("settings.map.providers.maptiler") },
    { value: "mapbox", label: t("settings.map.providers.mapbox") },
  ];
  const layers: Array<{ value: MapLayer; label: string }> = [
    { value: "osm", label: t("settings.map.layers.osm") },
    { value: "topo", label: t("settings.map.layers.topo") },
    { value: "light", label: t("settings.map.layers.light") },
    { value: "satellite", label: t("settings.map.layers.satellite") },
  ];

  return (
    <section className="office-card p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
        <Icon name="map" className="h-4 w-4 shrink-0 text-[var(--ink,#101310)]" />
        <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
          {t("settings.map.title")}
        </h2>
      </div>
      <p className="text-sm text-[var(--muted,#62685f)]">
        {t("settings.map.description")}
      </p>

      {saved && (
        <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--line,#dedcd1)] border-l-4 border-l-[var(--signal,#d8ff3e)] bg-[var(--paper,#f2efe6)] px-4 py-3 text-sm font-bold text-[var(--ink,#101310)]">
          <Icon name="check" className="h-4 w-4 shrink-0" />
          {t("settings.map.saved")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[#fae8e0] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          {error === "map-key" ? t("settings.map.missingKey") : t("settings.map.invalid")}
        </p>
      )}

      <form action={action} className="mt-6 max-w-2xl space-y-5">
        <label className="block">
          <span className={LABEL}>{t("settings.map.provider")}</span>
          <select
            name="provider"
            defaultValue={settings.provider}
            className={`${FIELD} mt-1`}
          >
            {providers.map((provider) => (
              <option key={provider.value} value={provider.value}>{provider.label}</option>
            ))}
          </select>
        </label>

        <div>
          <label htmlFor="map-api-key" className={LABEL}>
            {t("settings.map.apiKey")}
          </label>
          <input
            id="map-api-key"
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={settings.hasApiKey ? t("settings.map.keyStored") : t("settings.map.keyPlaceholder")}
            className={`${FIELD} mt-1`}
          />
          <p className="mt-1 text-xs text-[var(--muted,#62685f)]">{t("settings.map.keyHint")}</p>
          {settings.hasApiKey && (
            <label className="mt-2 flex min-h-11 items-center gap-2 text-xs font-bold text-[var(--ink,#101310)]">
              <input type="checkbox" name="clearApiKey" className="h-4 w-4 accent-[var(--ink,#101310)]" />
              {t("settings.map.clearKey")}
            </label>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>{t("settings.map.defaultLayer")}</span>
            <select
              name="defaultLayer"
              defaultValue={settings.defaultLayer}
              className={`${FIELD} mt-1`}
            >
              {layers.map((layer) => (
                <option key={layer.value} value={layer.value}>{layer.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>{t("settings.map.defaultZoom")}</span>
            <input
              name="defaultZoom"
              type="number"
              min={2}
              max={19}
              defaultValue={settings.defaultZoom}
              className={`${FIELD} mt-1`}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>{t("settings.map.centerLat")}</span>
            <input
              name="centerLat"
              type="number"
              step="any"
              min={-90}
              max={90}
              defaultValue={settings.centerLat ?? ""}
              className={`${FIELD} mt-1`}
            />
          </label>
          <label className="block">
            <span className={LABEL}>{t("settings.map.centerLng")}</span>
            <input
              name="centerLng"
              type="number"
              step="any"
              min={-180}
              max={180}
              defaultValue={settings.centerLng ?? ""}
              className={`${FIELD} mt-1`}
            />
          </label>
        </div>
        <p className="-mt-3 text-xs text-[var(--muted,#62685f)]">{t("settings.map.centerHint")}</p>

        <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-[var(--ink,#101310)]">
          <input
            type="checkbox"
            name="scrollWheelZoom"
            defaultChecked={settings.scrollWheelZoom}
            className="h-5 w-5 accent-[var(--ink,#101310)]"
          />
          {t("settings.map.scrollWheel")}
        </label>

        <button type="submit" className={SIGNAL_BUTTON}>
          {t("settings.map.save")}
        </button>
      </form>
    </section>
  );
}
