"use client";

import { useSyncExternalStore } from "react";
import Icon from "@/components/icons";
import {
  buildDirectionsUrl,
  detectMapPlatform,
  type MapPlatform,
  type MapTarget,
} from "@/lib/maps-links";

const subscribe = () => () => undefined;
const serverPlatform: MapPlatform = "desktop";

function currentPlatform(): MapPlatform {
  if (typeof navigator === "undefined") return serverPlatform;
  return detectMapPlatform(navigator.userAgent, navigator.maxTouchPoints);
}

/**
 * Plattformbevisst navigasjonslenke. iOS får Apple Maps, Android får `geo:`,
 * og skrivebordet får Google Maps. Selve URL-byggingen er en ren funksjon i
 * `src/lib/maps-links.ts`, så den kan testes uten nettleser.
 */
export default function NavigateLink({
  latitude,
  longitude,
  address,
  postalCode,
  city,
  label,
  ariaLabel,
  newTabLabel,
  className,
  showIcon = true,
}: MapTarget & {
  label: string;
  ariaLabel?: string;
  newTabLabel?: string;
  className?: string;
  showIcon?: boolean;
}) {
  const platform = useSyncExternalStore(
    subscribe,
    currentPlatform,
    () => serverPlatform,
  );
  const href = buildDirectionsUrl(
    { latitude, longitude, address, postalCode, city },
    platform,
  );
  if (!href) return null;

  const opensWeb = href.startsWith("http");
  return (
    <a
      href={href}
      aria-label={ariaLabel || label}
      className={`inline-flex items-center gap-1.5 font-bold transition ${className || ""}`}
      {...(opensWeb
        ? { target: "_blank", rel: "noopener noreferrer" }
        : {})}
    >
      {showIcon ? (
        <Icon name="navigation" className="h-4 w-4 shrink-0" />
      ) : null}
      <span>{label}</span>
      {opensWeb && newTabLabel ? (
        <span className="sr-only"> ({newTabLabel})</span>
      ) : null}
    </a>
  );
}
