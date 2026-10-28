"use client";

import { useEffect, useRef } from "react";

export type WorkOrderMapPoint = {
  id: string;
  title: string;
  href: string;
  customerName: string;
  address: string;
  date: string;
  status: string;
  lat: number;
  lng: number;
};

/**
 * Interaktivt OpenStreetMap-kart med ett klikkbart punkt per oppdrag.
 *
 * Selve kartbiblioteket lastes først i nettleseren, slik at serverrendringen
 * ikke trenger DOM/window. Popupen bygges med DOM-noder og textContent, ikke
 * HTML-strenger, slik at kunde- og oppdragstekst aldri kan bli HTML.
 */
export default function WorkOrderMap({
  points,
  ariaLabel,
  noPointsLabel,
  openLabel,
  layerLabels,
  settings,
}: {
  points: WorkOrderMapPoint[];
  ariaLabel: string;
  noPointsLabel: string;
  openLabel: string;
  layerLabels: {
    osm: string;
    topo: string;
    light: string;
    satellite: string;
  };
  settings: {
    provider: "osm" | "maptiler" | "mapbox";
    apiKey: string | null;
    defaultLayer: "osm" | "topo" | "light" | "satellite";
    defaultZoom: number;
    centerLat: number | null;
    centerLng: number | null;
    scrollWheelZoom: boolean;
  };
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | null = null;

    const init = async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current, {
        scrollWheelZoom: settings.scrollWheelZoom,
        wheelDebounceTime: 40,
        wheelPxPerZoomLevel: 90,
        keyboard: true,
        zoomControl: true,
      });

      const apiKey = settings.apiKey ? encodeURIComponent(settings.apiKey) : "";
      let baseLayers: Record<string, import("leaflet").TileLayer>;
      if (settings.provider === "maptiler" && apiKey) {
        baseLayers = {
          [layerLabels.osm]: L.tileLayer(
            `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${apiKey}`,
            { maxZoom: 22, attribution: "&copy; MapTiler &copy; OpenStreetMap" },
          ),
          [layerLabels.topo]: L.tileLayer(
            `https://api.maptiler.com/maps/outdoor-v2/{z}/{x}/{y}.png?key=${apiKey}`,
            { maxZoom: 22, attribution: "&copy; MapTiler &copy; OpenStreetMap" },
          ),
          [layerLabels.light]: L.tileLayer(
            `https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=${apiKey}`,
            { maxZoom: 22, attribution: "&copy; MapTiler &copy; OpenStreetMap" },
          ),
          [layerLabels.satellite]: L.tileLayer(
            `https://api.maptiler.com/maps/satellite-v2/{z}/{x}/{y}.png?key=${apiKey}`,
            { maxZoom: 20, attribution: "&copy; MapTiler &copy; OpenStreetMap" },
          ),
        };
      } else if (settings.provider === "mapbox" && apiKey) {
        const token = `access_token=${apiKey}`;
        baseLayers = {
          [layerLabels.osm]: L.tileLayer(
            `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?${token}`,
            { maxZoom: 22, attribution: "&copy; Mapbox &copy; OpenStreetMap" },
          ),
          [layerLabels.topo]: L.tileLayer(
            `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/256/{z}/{x}/{y}@2x?${token}`,
            { maxZoom: 22, attribution: "&copy; Mapbox &copy; OpenStreetMap" },
          ),
          [layerLabels.light]: L.tileLayer(
            `https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/{z}/{x}/{y}@2x?${token}`,
            { maxZoom: 22, attribution: "&copy; Mapbox &copy; OpenStreetMap" },
          ),
          [layerLabels.satellite]: L.tileLayer(
            `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}@2x?${token}`,
            { maxZoom: 22, attribution: "&copy; Mapbox &copy; OpenStreetMap" },
          ),
        };
      } else {
        baseLayers = {
          [layerLabels.osm]: L.tileLayer(
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
              maxZoom: 19,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
            },
          ),
          [layerLabels.topo]: L.tileLayer(
            "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
            {
              maxZoom: 17,
              attribution:
                'Kartdata &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>, OpenTopoMap',
            },
          ),
          [layerLabels.light]: L.tileLayer(
            "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            {
              maxZoom: 20,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>, &copy; CARTO',
            },
          ),
          [layerLabels.satellite]: L.tileLayer(
            "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            {
              maxZoom: 18,
              attribution:
                "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community",
            },
          ),
        };
      }
      const layerKeys = Object.keys(baseLayers);
      const selectedLayer =
        baseLayers[
          settings.defaultLayer === "osm"
            ? layerLabels.osm
            : settings.defaultLayer === "topo"
              ? layerLabels.topo
              : settings.defaultLayer === "light"
                ? layerLabels.light
                : layerLabels.satellite
        ] ?? baseLayers[layerKeys[0]];
      selectedLayer.addTo(map);
      L.control.layers(baseLayers, undefined, { collapsed: true }).addTo(map);

      const bounds = L.latLngBounds([]);

      for (const point of points) {
        const latLng = L.latLng(point.lat, point.lng);
        bounds.extend(latLng);

        const icon = L.divIcon({
          className: "work-order-map-marker",
          html: '<span aria-hidden="true">📍</span>',
          iconSize: [34, 34],
          iconAnchor: [17, 32],
          popupAnchor: [0, -28],
        });

        const marker = L.marker(latLng, {
          icon,
          title: point.title,
          keyboard: true,
        }).addTo(map);

        const popup = document.createElement("div");
        popup.className = "work-order-map-popup";

        const title = document.createElement("strong");
        title.textContent = point.title;
        popup.appendChild(title);

        const customer = document.createElement("div");
        customer.className = "work-order-map-popup-meta";
        customer.textContent = point.customerName;
        popup.appendChild(customer);

        if (point.address) {
          const address = document.createElement("div");
          address.className = "work-order-map-popup-meta";
          address.textContent = point.address;
          popup.appendChild(address);
        }

        const date = document.createElement("div");
        date.className = "work-order-map-popup-meta";
        date.textContent = `${point.date} · ${point.status}`;
        popup.appendChild(date);

        const link = document.createElement("a");
        link.href = point.href;
        link.className = "work-order-map-popup-link";
        link.textContent = `${openLabel} →`;
        popup.appendChild(link);

        marker.bindPopup(popup);
      }

      if (points.length === 1) {
        map.setView([points[0].lat, points[0].lng], 11);
      } else if (points.length > 1) {
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
      } else {
        map.setView(
          [
            settings.centerLat ?? 64.5,
            settings.centerLng ?? 12,
          ],
          settings.defaultZoom,
        );
      }
    };

    void init().catch(() => {
      // Kartet er en visuell hjelp; listen under fungerer uten kartet.
    });

    return () => {
      cancelled = true;
      map?.remove();
      map = null;
    };
  }, [points, openLabel, layerLabels, settings]);

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        role="application"
        aria-label={ariaLabel}
        className="z-0 h-[420px] w-full overflow-hidden rounded-2xl border-2 border-gray-200 bg-gray-100 sm:h-[520px]"
      />
      {points.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-3 text-sm text-gray-600">
          {noPointsLabel}
        </p>
      )}
    </div>
  );
}
