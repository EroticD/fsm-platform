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
}: {
  points: WorkOrderMapPoint[];
  ariaLabel: string;
  noPointsLabel: string;
  openLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | null = null;

    const init = async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current, {
        scrollWheelZoom: false,
        keyboard: true,
        zoomControl: true,
      });

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      }).addTo(map);

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
        map.setView([64.5, 12], 4);
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
  }, [points, openLabel]);

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
