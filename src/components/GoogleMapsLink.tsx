"use client";

import Icon from "@/components/icons";

export default function GoogleMapsLink({
  address,
  postalCode,
  city,
  label,
  newTabLabel,
  className,
  showIcon = true,
}: {
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  label?: string;
  /** Skjermlesertekst som forklarer at lenken åpnes i ny fane. */
  newTabLabel?: string;
  className?: string;
  /** Vis merkenålen foran lenketeksten. På som standard. */
  showIcon?: boolean;
}) {
  const parts = [address, postalCode, city].filter(Boolean);
  const query = parts.join(", ");

  if (!query.trim()) return null;

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

  return (
    <a
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 font-bold text-[var(--ink,#101310)] transition hover:text-[var(--ink,#101310)] ${className || ""}`}
    >
      {showIcon ? (
        <Icon
          name="brandNav"
          className="mr-1.5 inline-block h-4 w-4 shrink-0 align-[-0.125em]"
        />
      ) : null}
      {label || query}
      {newTabLabel ? <span className="sr-only"> ({newTabLabel})</span> : null}
    </a>
  );
}
