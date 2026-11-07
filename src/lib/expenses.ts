/**
 * Beregninger og CSV-kontrakt for kjøreturer, utlegg og lønnsgrunnlag.
 *
 * All avrunding skjer til øre med `Math.round`, slik at klienten aldri kan
 * bestemme beløpet. Lønnsfilen er semikolonseparert med BOM fordi den åpnes i
 * norsk Excel; kolonnene er dokumentert i docs/PAYROLL_EXPORT.md.
 */
import { toCsv } from "@/lib/csv";

/** Standard sats per kilometer når brukeren ikke oppgir egen sats. */
export const DEFAULT_MILEAGE_RATE = 3.5;

/** Standard mva-sats for utlegg når kvitteringen ikke sier noe annet. */
export const DEFAULT_VAT_RATE = 25;

export function roundOre(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Kilometer × sats, avrundet til øre. */
export function calculateMileageAmount(km: number, rate: number): number {
  return roundOre(km * rate);
}

/**
 * Trekker mva ut av et bruttobeløp: `brutto × sats / (100 + sats)`.
 * Et utlegg på 125 kr med 25 % mva gir 25 kr mva og 100 kr netto.
 */
export function calculateVatFromGross(
  grossAmount: number,
  vatRatePercent: number,
): number {
  if (vatRatePercent <= 0) return 0;
  return roundOre((grossAmount * vatRatePercent) / (100 + vatRatePercent));
}

/** Validerer at en mva-del ikke er større enn bruttobeløpet. */
export function isValidVatAmount(
  grossAmount: number,
  vatAmount: number,
): boolean {
  return vatAmount >= 0 && vatAmount <= grossAmount;
}

export type PayrollCsvRow = {
  type: "WORK" | "TRAVEL" | "MILEAGE" | "EXPENSE";
  userName: string;
  date: string;
  reference: string;
  description: string;
  quantity: number;
  unit: string;
  amount: number;
  vatAmount: number;
};

export const PAYROLL_CSV_HEADER = [
  "type",
  "bruker",
  "dato",
  "referanse",
  "beskrivelse",
  "mengde",
  "enhet",
  "belop",
  "mva",
] as const;

function decimal(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

/** Bygger den eksakte CSV-filen som eksporten lagrer og returnerer. */
export function payrollCsv(rows: PayrollCsvRow[]): string {
  return toCsv(
    [...PAYROLL_CSV_HEADER],
    rows.map((row) => [
      row.type,
      row.userName,
      row.date,
      row.reference,
      row.description,
      String(row.quantity).replace(".", ","),
      row.unit,
      decimal(row.amount),
      decimal(row.vatAmount),
    ]),
  );
}
