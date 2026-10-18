"use client";

export default function GoogleMapsLink({
  address,
  postalCode,
  city,
  label,
  className,
}: {
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  label?: string;
  className?: string;
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
      className={`text-blue-600 font-bold hover:underline transition ${className || ""}`}
    >
      {label || query}
    </a>
  );
}
