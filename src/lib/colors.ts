/**
 * Velger svart eller hvit tekst ut fra bakgrunnsfargens luminans.
 *
 * Brukes på tag-merker, kalenderhendelser og den aktive navigasjonsknappen, slik
 * at kontrasten holder uansett hvilken farge som er valgt. Vi sammenligner
 * faktisk WCAG-kontrast mot hvitt og svart i stedet for en enkel terskel – det
 * er viktig for gule og oransje farger, der hvit tekst ellers blir uleselig.
 */
export function readableTextColor(hex: string | null | undefined): string {
  const value = (hex ?? "").replace("#", "").trim();
  if (value.length !== 6 || !/^[0-9a-f]{6}$/i.test(value)) return "#111827";

  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;

  const linear = (channel: number) =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;

  const luminance =
    0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

  // Kontrast mot hvitt (#fff) og nesten-svart (#111827).
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackLuminance = 0.0103; // relativ luminans for #111827
  const blackContrast =
    (Math.max(luminance, blackLuminance) + 0.05) /
    (Math.min(luminance, blackLuminance) + 0.05);

  return blackContrast >= whiteContrast ? "#111827" : "#ffffff";
}
