import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import type { MapLayer, MapProvider, MapSettingsView } from "@/server/map-settings";

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
    <section className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="flex items-center gap-2 text-xl font-black text-gray-900">
          <Icon name="map" className="h-5 w-5 shrink-0" />
          {t("settings.map.title")}
        </h2>
        <p className="mt-1 text-sm text-gray-600">{t("settings.map.description")}</p>

        {saved && (
          <p role="status" className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-900">
            {t("settings.map.saved")}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">
            {error === "map-key" ? t("settings.map.missingKey") : t("settings.map.invalid")}
          </p>
        )}

        <form action={action} className="mt-6 space-y-5">
          <label className="block text-sm font-bold text-gray-800">
            {t("settings.map.provider")}
            <select
              name="provider"
              defaultValue={settings.provider}
              className="mt-1 w-full rounded-xl border-2 border-gray-300 bg-white p-3 text-sm font-medium text-gray-900"
            >
              {providers.map((provider) => (
                <option key={provider.value} value={provider.value}>{provider.label}</option>
              ))}
            </select>
          </label>

          <div>
            <label htmlFor="map-api-key" className="block text-sm font-bold text-gray-800">
              {t("settings.map.apiKey")}
            </label>
            <input
              id="map-api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              placeholder={settings.hasApiKey ? t("settings.map.keyStored") : t("settings.map.keyPlaceholder")}
              className="mt-1 w-full rounded-xl border-2 border-gray-300 bg-white p-3 text-sm font-medium text-gray-900"
            />
            <p className="mt-1 text-xs text-gray-600">{t("settings.map.keyHint")}</p>
            {settings.hasApiKey && (
              <label className="mt-2 flex items-center gap-2 text-xs font-bold text-gray-700">
                <input type="checkbox" name="clearApiKey" className="h-4 w-4" />
                {t("settings.map.clearKey")}
              </label>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold text-gray-800">
              {t("settings.map.defaultLayer")}
              <select
                name="defaultLayer"
                defaultValue={settings.defaultLayer}
                className="mt-1 w-full rounded-xl border-2 border-gray-300 bg-white p-3 text-sm font-medium text-gray-900"
              >
                {layers.map((layer) => (
                  <option key={layer.value} value={layer.value}>{layer.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold text-gray-800">
              {t("settings.map.defaultZoom")}
              <input
                name="defaultZoom"
                type="number"
                min={2}
                max={19}
                defaultValue={settings.defaultZoom}
                className="mt-1 w-full rounded-xl border-2 border-gray-300 bg-white p-3 text-sm font-medium text-gray-900"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold text-gray-800">
              {t("settings.map.centerLat")}
              <input
                name="centerLat"
                type="number"
                step="any"
                min={-90}
                max={90}
                defaultValue={settings.centerLat ?? ""}
                className="mt-1 w-full rounded-xl border-2 border-gray-300 bg-white p-3 text-sm font-medium text-gray-900"
              />
            </label>
            <label className="block text-sm font-bold text-gray-800">
              {t("settings.map.centerLng")}
              <input
                name="centerLng"
                type="number"
                step="any"
                min={-180}
                max={180}
                defaultValue={settings.centerLng ?? ""}
                className="mt-1 w-full rounded-xl border-2 border-gray-300 bg-white p-3 text-sm font-medium text-gray-900"
              />
            </label>
          </div>
          <p className="-mt-3 text-xs text-gray-600">{t("settings.map.centerHint")}</p>

          <label className="flex items-center gap-3 text-sm font-bold text-gray-800">
            <input
              type="checkbox"
              name="scrollWheelZoom"
              defaultChecked={settings.scrollWheelZoom}
              className="h-5 w-5"
            />
            {t("settings.map.scrollWheel")}
          </label>

          <button
            type="submit"
            className="min-h-11 rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-sm font-bold text-white hover:opacity-90"
          >
            {t("settings.map.save")}
          </button>
        </form>
      </div>
    </section>
  );
}
