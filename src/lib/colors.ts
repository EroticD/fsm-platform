/**
 * Velger svart eller hvit tekst ut fra bakgrunnsfargens luminans.
 * Brukes på tag-merker med brukerdefinerte farger, slik at kontrasten holder
 * uansett hvilken farge som er valgt.
 */
export function readableTextColor(hex: string | null | undefined): string {
  const value = (hex ?? "").replace("#", "").trim();
  if (value.length !== 6 || !/^[0-9a-f]{6}$/i.test(value)) return "#111827";

  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111827" : "#ffffff";
}
