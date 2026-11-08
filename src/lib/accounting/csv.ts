// i18n-ignore-file: CSV-eksport er driftsdata, ikke UI-tekst.
import { toCsv } from "@/lib/csv";
import type {
  AccountingConnectionResult,
  AccountingCustomerInput,
  AccountingInvoiceInput,
  AccountingPaymentInput,
  AccountingProvider,
  AccountingSyncResult,
} from "./types";

/**
 * Generisk CSV-fallback.
 *
 * Dette er ikke en ekstern integrasjon. Konnektoren lager en stabil fil lokalt
 * og merker synken `EXPORTED`, slik at ingen tror at regnskapet er oppdatert.
 * Filen kan lastes ned og importeres manuelt i valgfritt system.
 */

const CUSTOMER_HEADER = [
  "Kundenummer",
  "Kunde",
  "Org.nr.",
  "E-post",
  "Telefon",
  "Adresse",
  "Postnummer",
  "Sted",
];

const INVOICE_HEADER = [
  "Fakturanummer",
  "Fakturadato",
  "Forfallsdato",
  "Valuta",
  "Kunde",
  "Org.nr.",
  "Beskrivelse",
  "Antall",
  "Enhet",
  "Pris",
  "MVA %",
  "Linjesum",
  "Netto",
  "MVA",
  "Totalt",
];

const PAYMENT_HEADER = [
  "Fakturanummer",
  "Betalt dato",
  "Beløp",
  "Valuta",
  "Metode",
  "Referanse",
];

function csvText(header: string[], rows: string[][]): string {
  return toCsv(header, rows);
}

export const csvProvider: AccountingProvider = {
  name: "csv",
  mode: "export",

  configured(): boolean {
    return true;
  },

  async testConnection(): Promise<AccountingConnectionResult> {
    return { ok: true, message: "export_only", detail: "CSV" };
  },

  async syncCustomer(input: AccountingCustomerInput): Promise<AccountingSyncResult> {
    const csv = csvText(CUSTOMER_HEADER, [
      [
        input.id,
        input.name,
        input.orgNumber ?? "",
        input.email ?? "",
        input.phone ?? "",
        input.address ?? "",
        input.postalCode ?? "",
        input.city ?? "",
      ],
    ]);
    return {
      externalId: `csv-customer:${input.id}`,
      externalNumber: null,
      mode: "export",
      csv,
    };
  },

  async syncInvoice(input: AccountingInvoiceInput): Promise<AccountingSyncResult> {
    const rows = input.lines.map((line) => [
      input.invoiceNumber ?? "",
      input.issueDate,
      input.dueDate,
      input.currency,
      input.customer.name,
      input.customer.orgNumber ?? "",
      line.description,
      line.quantity,
      line.unit,
      line.unitPrice,
      line.vatRate,
      line.lineTotal,
      input.subtotal,
      input.vatTotal,
      input.total,
    ]);
    const csv = csvText(INVOICE_HEADER, rows);
    return {
      externalId: `csv-invoice:${input.id}`,
      externalNumber: input.invoiceNumber,
      mode: "export",
      csv,
    };
  },

  async recordPayment(input: AccountingPaymentInput): Promise<AccountingSyncResult> {
    const csv = csvText(PAYMENT_HEADER, [
      [
        input.invoiceNumber ?? "",
        input.paidAt,
        input.amount,
        input.currency,
        input.method,
        input.reference ?? "",
      ],
    ]);
    return {
      externalId: `csv-payment:${input.id}`,
      externalNumber: null,
      mode: "export",
      csv,
    };
  },
};
