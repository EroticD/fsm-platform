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
  /** Statusfarge fra den felles statuspaletten. */
  color: string;
  technicians: string;
  lat: number;
  lng: number;
};

/**
 * Interaktivt OpenStreetMap-kart med ett klikkbart punkt per oppdrag.
 *
 * Selve kartbiblioteket lastes først i nettleseren, slik at serverrendringen
 * ikke trenger DOM/window. Popupen bygges med DOM-noder og textContent, ikke
 * HTML-strenger, slik at kunde- og oppdragstekst aldri kan bli HTML.
 *
 * Kartet er en visuell hjelp. Alle punktene finnes også som vanlige lenker i
 * listen på siden, og kartregionen er knyttet til listen med aria-controls.
 */
export default function WorkOrderMap({
  points,
  ariaLabel,
  noPointsLabel,
  openLabel,
  listId,
  listHint,
  layerLabels,
  settings,
}: {
  points: WorkOrderMapPoint[];
  ariaLabel: string;
  noPointsLabel: string;
  openLabel: string;
  /** id-en til listen som inneholder de samme oppdragene som lenker. */
  listId: string;
  /** Kort skjermleserhint om forholdet mellom kartet og listen. */
  listHint: string;
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
    let currentMapZoomHandler: (() => void) | null = null;

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

      const markerLayer = L.layerGroup().addTo(map);

      const buildPopup = (point: WorkOrderMapPoint) => {
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

        if (point.technicians) {
          const technicians = document.createElement("div");
          technicians.className = "work-order-map-popup-meta";
          technicians.textContent = `👷 ${point.technicians}`;
          popup.appendChild(technicians);
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

        return popup;
      };

      const addIndividualMarker = (point: WorkOrderMapPoint) => {
        const dot = document.createElement("span");
        dot.className = "work-order-map-marker-dot";
        dot.style.backgroundColor = point.color;
        dot.setAttribute("aria-hidden", "true");

        const icon = L.divIcon({
          className: "work-order-map-marker",
          html: dot,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          popupAnchor: [0, -16],
        });

        const marker = L.marker([point.lat, point.lng], {
          icon,
          title: `${point.title} · ${point.status}`,
          keyboard: true,
        });
        marker.bindPopup(buildPopup(point));
        markerLayer.addLayer(marker);
      };

      const addClusterMarker = (
        group: WorkOrderMapPoint[],
        currentMap: import("leaflet").Map,
      ) => {
        const groupBounds = L.latLngBounds(
          group.map((point) => [point.lat, point.lng] as [number, number]),
        );
        const badge = document.createElement("span");
        badge.className = "work-order-map-cluster";
        badge.textContent = String(group.length);
        badge.setAttribute("aria-hidden", "true");

        const icon = L.divIcon({
          className: "work-order-map-cluster-icon",
          html: badge,
          iconSize: [42, 42],
          iconAnchor: [21, 21],
        });

        const marker = L.marker(groupBounds.getCenter(), {
          icon,
          title: String(group.length),
          keyboard: true,
        });
        marker.on("click", () => {
          currentMap.fitBounds(groupBounds, {
            padding: [48, 48],
            maxZoom: 15,
          });
        });
        markerLayer.addLayer(marker);
      };

      const renderMarkers = () => {
        const currentMap = map;
        if (!currentMap) return;

        markerLayer.clearLayers();
        const zoom = currentMap.getZoom();
        // Over zoom 14 er det plass til enkeltmarkører. Under det grupperes
        // punkter i rutenett, slik at tette bydeler ikke blir en vegg av prikker.
        const cellSize = zoom >= 14 ? 0 : 180 / 2 ** zoom;
        const groups = new Map<string, WorkOrderMapPoint[]>();

        for (const point of points) {
          const key = cellSize
            ? `${Math.round(point.lat / cellSize)}:${Math.round(point.lng / cellSize)}`
            : `id:${point.id}`;
          const group = groups.get(key) ?? [];
          group.push(point);
          groups.set(key, group);
        }

        for (const group of groups.values()) {
          if (group.length === 1) {
            addIndividualMarker(group[0]);
          } else {
            addClusterMarker(group, currentMap);
          }
        }
      };

      currentMapZoomHandler = renderMarkers;
      map.on("zoomend", renderMarkers);
      renderMarkers();

      const bounds = L.latLngBounds(
        points.map((point) => [point.lat, point.lng] as [number, number]),
      );

      if (points.length === 1) {
        map.setView([points[0].lat, points[0].lng], 11);
      } else if (points.length > 1) {
        map.fitBounds(bounds, { padding: [32, 32], maxZoom: 12 });
      } else {
        map.setView(
          [settings.centerLat ?? 64.5, settings.centerLng ?? 12],
          settings.defaultZoom,
        );
      }
    };

    void init().catch(() => {
      // Kartet er en visuell hjelp; listen under fungerer uten kartet.
    });

    return () => {
      cancelled = true;
      if (map && currentMapZoomHandler) {
        map.off("zoomend", currentMapZoomHandler);
      }
      map?.remove();
      map = null;
    };
  }, [points, openLabel, layerLabels, settings]);

  return (
    <div className="space-y-2">
      <p id={`${listId}-hint`} className="sr-only">
        {listHint}
      </p>
      <div
        ref={containerRef}
        role="region"
        aria-label={ariaLabel}
        aria-describedby={`${listId}-hint`}
        aria-controls={listId}
        tabIndex={0}
        className="z-0 h-[420px] w-full overflow-hidden rounded-2xl border-2 border-gray-200 bg-gray-100 sm:h-[520px]"
      />
      {points.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-3 text-sm text-gray-600">
          {noPointsLabel}
        </p>
      )}
      <style jsx global>{`
        .work-order-map-marker {
          background: transparent;
          border: none;
        }
        .work-order-map-marker-dot {
          display: flex;
          height: 26px;
          width: 26px;
          border: 3px solid #fff;
          border-radius: 9999px;
          box-shadow: 0 1px 5px rgb(0 0 0 / 0.35);
        }
        .work-order-map-cluster-icon {
          background: transparent;
          border: none;
        }
        .work-order-map-cluster {
          display: flex;
          height: 38px;
          width: 38px;
          align-items: center;
          justify-content: center;
          border: 3px solid #fff;
          border-radius: 9999px;
          background: #1d4ed8;
          color: #fff;
          font-size: 13px;
          font-weight: 800;
          box-shadow: 0 2px 8px rgb(0 0 0 / 0.35);
        }
        .work-order-map-popup-meta {
          margin-top: 2px;
          font-size: 12px;
          color: #4b5563;
        }
        .work-order-map-popup-link {
          display: inline-block;
          margin-top: 6px;
          font-size: 12px;
          font-weight: 700;
          color: #1d4ed8;
        }
      `}</style>
    </div>
  );
}
