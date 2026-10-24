/**
 * Lager én trygg CSV-celle.
 *
 * Felt som starter med =, +, -, @, tab eller CR tolkes som formel av Excel og
 * LibreOffice. Vi prefikser med apostrof, som regnearket viser som ren tekst.
 */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Bygger en semikolonseparert CSV med BOM, slik at Excel beholder UTF-8. */
export function toCsv(
  header: string[],
  rows: unknown[][],
): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(";"));
  return `\uFEFF${lines.join("\r\n")}`;
}
