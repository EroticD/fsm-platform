import {
  BRAND_CHECK_PATH,
  BRAND_COLORS,
  BRAND_PIN_PATH,
  BRAND_TILE_RADIUS,
} from "@/lib/brand";

export type BrandMarkTone = "signal" | "ink";

export type BrandMarkProps = {
  /** Sidestørrelse i piksler. Merket er tegnet for 18–48 px. */
  size?: number;
  className?: string;
  /** Tilgjengelig navn. Utelates merket, blir det dekorativt. */
  title?: string;
  /**
   * signal: lime flate med blekk-nål (standard).
   * ink: blekkflate med signal-nål, for lyse flater der limen trenger mer ramme.
   */
  tone?: BrandMarkTone;
};

/**
 * Merket som inline SVG, med samme geometri som favicon og PWA-ikonene.
 *
 * Stiene ligger i et 64 × 64-rutenett. Vi tegner fortsatt i det rutenettet og
 * lar `size` styre den faktiske størrelsen, slik at haken og nålen holder seg
 * skarpe helt ned til 18 px uten egne småvarianter.
 */
export default function BrandMark({
  size = 36,
  className,
  title,
  tone = "signal",
}: BrandMarkProps) {
  const label = title?.trim();
  const isSignal = tone === "signal";
  const tileColor = isSignal ? BRAND_COLORS.signal : BRAND_COLORS.ink;
  const pinColor = isSignal ? BRAND_COLORS.ink : BRAND_COLORS.signal;
  const checkColor = isSignal ? BRAND_COLORS.signal : BRAND_COLORS.ink;
  const borderColor = isSignal ? BRAND_COLORS.ink : BRAND_COLORS.signal;
  const inset = 0.75;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label || undefined}
      focusable="false"
      data-tone={tone}
    >
      {label ? <title>{label}</title> : null}
      <rect
        x={inset}
        y={inset}
        width={64 - inset * 2}
        height={64 - inset * 2}
        rx={BRAND_TILE_RADIUS - inset}
        fill={tileColor}
        stroke={borderColor}
        strokeOpacity={isSignal ? 0.18 : 0.35}
        strokeWidth={1.5}
      />
      <path d={BRAND_PIN_PATH} fill={pinColor} />
      <path
        d={BRAND_CHECK_PATH}
        fill="none"
        stroke={checkColor}
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
