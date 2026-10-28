import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { can, fail, ok, toAuditActor, type ServiceActor, type ServiceResult } from "./actor";

export type MapProvider = "osm" | "maptiler" | "mapbox";
export type MapLayer = "osm" | "topo" | "light" | "satellite";

export const MAP_PROVIDERS: readonly MapProvider[] = ["osm", "maptiler", "mapbox"];
export const MAP_LAYERS: readonly MapLayer[] = ["osm", "topo", "light", "satellite"];

export type MapSettings = {
  provider: MapProvider;
  apiKey: string | null;
  defaultLayer: MapLayer;
  defaultZoom: number;
  centerLat: number | null;
  centerLng: number | null;
  scrollWheelZoom: boolean;
};

export type MapSettingsView = Omit<MapSettings, "apiKey"> & {
  hasApiKey: boolean;
};

const DEFAULTS: MapSettings = {
  provider: "osm",
  apiKey: null,
  defaultLayer: "osm",
  defaultZoom: 6,
  centerLat: null,
  centerLng: null,
  scrollWheelZoom: true,
};

function isProvider(value: unknown): value is MapProvider {
  return typeof value === "string" && (MAP_PROVIDERS as readonly string[]).includes(value);
}

function isLayer(value: unknown): value is MapLayer {
  return typeof value === "string" && (MAP_LAYERS as readonly string[]).includes(value);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToSettings(row: {
  provider: string;
  apiKey: string | null;
  defaultLayer: string;
  defaultZoom: number;
  centerLat: number | null;
  centerLng: number | null;
  scrollWheelZoom: boolean;
} | null): MapSettings {
  if (!row) return { ...DEFAULTS };
  return {
    provider: isProvider(row.provider) ? row.provider : DEFAULTS.provider,
    apiKey: row.apiKey?.trim() || null,
    defaultLayer: isLayer(row.defaultLayer) ? row.defaultLayer : DEFAULTS.defaultLayer,
    defaultZoom: Math.min(19, Math.max(2, Math.trunc(row.defaultZoom) || DEFAULTS.defaultZoom)),
    centerLat: row.centerLat,
    centerLng: row.centerLng,
    scrollWheelZoom: row.scrollWheelZoom,
  };
}

/** Brukes av kartet, som trenger selve nøkkelen for å hente fliser. */
export async function getMapSettings(): Promise<MapSettings> {
  const row = await prisma.mapSettings.findUnique({ where: { id: "default" } });
  return rowToSettings(row);
}

/** Brukes av innstillinger; API-nøkkelen sendes aldri til klienten. */
export async function getMapSettingsView(
  actor: ServiceActor,
): Promise<ServiceResult<MapSettingsView>> {
  if (!can(actor, "settings.manage")) return fail("forbidden");
  const settings = await getMapSettings();
  const { apiKey, ...safe } = settings;
  return ok({ ...safe, hasApiKey: Boolean(apiKey) });
}

export type SaveMapSettingsInput = {
  provider?: unknown;
  apiKey?: unknown;
  clearApiKey?: unknown;
  defaultLayer?: unknown;
  defaultZoom?: unknown;
  centerLat?: unknown;
  centerLng?: unknown;
  scrollWheelZoom?: unknown;
};

export async function saveMapSettings(
  actor: ServiceActor,
  input: SaveMapSettingsInput,
): Promise<ServiceResult<MapSettingsView>> {
  if (!can(actor, "settings.manage")) return fail("forbidden");

  const provider = isProvider(input.provider) ? input.provider : "osm";
  const defaultLayer = isLayer(input.defaultLayer) ? input.defaultLayer : "osm";
  const defaultZoom = Math.min(
    19,
    Math.max(2, Math.trunc(Number(input.defaultZoom)) || DEFAULTS.defaultZoom),
  );
  const centerLat = numberOrNull(input.centerLat);
  const centerLng = numberOrNull(input.centerLng);
  if (
    (centerLat === null) !== (centerLng === null) ||
    (centerLat !== null && (centerLat < -90 || centerLat > 90)) ||
    (centerLng !== null && (centerLng < -180 || centerLng > 180))
  ) {
    return fail("invalid");
  }

  const existing = await getMapSettings();
  const clearApiKey = input.clearApiKey === "on" || input.clearApiKey === "true";
  const suppliedKey =
    typeof input.apiKey === "string" ? input.apiKey.trim().slice(0, 500) : "";
  const apiKey = clearApiKey
    ? null
    : suppliedKey || existing.apiKey;

  // En leverandør som krever nøkkel skal ikke lagres uten at nøkkelen finnes.
  if (provider !== "osm" && !apiKey) {
    return fail("missing_fields", { field: "apiKey" });
  }

  const settings: MapSettings = {
    provider,
    apiKey,
    defaultLayer,
    defaultZoom,
    centerLat,
    centerLng,
    scrollWheelZoom:
      input.scrollWheelZoom === "on" ||
      input.scrollWheelZoom === "true" ||
      input.scrollWheelZoom === undefined
        ? true
        : false,
  };

  await prisma.$transaction(async (tx) => {
    await tx.mapSettings.upsert({
      where: { id: "default" },
      update: {
        provider: settings.provider,
        apiKey: settings.apiKey,
        defaultLayer: settings.defaultLayer,
        defaultZoom: settings.defaultZoom,
        centerLat: settings.centerLat,
        centerLng: settings.centerLng,
        scrollWheelZoom: settings.scrollWheelZoom,
      },
      create: {
        id: "default",
        provider: settings.provider,
        apiKey: settings.apiKey,
        defaultLayer: settings.defaultLayer,
        defaultZoom: settings.defaultZoom,
        centerLat: settings.centerLat,
        centerLng: settings.centerLng,
        scrollWheelZoom: settings.scrollWheelZoom,
      },
    });

    await audit(tx, {
      entityType: "MapSettings",
      entityId: "default",
      action: "Oppdaterte kartinnstillinger",
      actor: toAuditActor(actor),
      metadata: {
        provider: settings.provider,
        defaultLayer: settings.defaultLayer,
        defaultZoom: settings.defaultZoom,
        hasApiKey: Boolean(settings.apiKey),
      },
    });
  });

  const { apiKey: _key, ...safe } = settings;
  return ok({ ...safe, hasApiKey: Boolean(settings.apiKey) });
}
