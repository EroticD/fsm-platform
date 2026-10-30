// i18n-ignore-file: PDF-etikettene er en egen, locale-nøklet tabell fordi
// react-pdf rendres utenfor next-intl-konteksten. Norsk er standard og skal
// være byte-for-byte lik den gamle PDF-teksten.
/**
 * Etiketter for servicerapport-PDF-en.
 *
 * PDF-motoren (react-pdf) har ikke tilgang til request-locale. Rapporten
 * rendres derfor med en eksplisitt locale, og standarden er `nb` fordi eldre
 * rapporter og arkiverte PDF-er er norske. `en` er klargjort for senere
 * PDF-lokalisering uten å endre norsk utdata.
 */
export type PdfLabels = {
  documentTitle: string;
  hmsDocumentation: string;
  hmsIncluded: string;
  hmsSuffix: string;
  companyFallback: string;
  answerYes: string;
  answerNo: string;
  answerUnanswered: string;
  notSigned: string;
  lineComment: string;
  noImages: string;
  customer: string;
  workOrder: string;
  notSpecified: string;
  statusPrefix: string;
  unknownStatus: string;
  datePrefix: string;
  noDate: string;
  technicianPrefix: string;
  approved: string;
  deviationFound: string;
  unknownResult: string;
  unitCount: (count: number) => string;
  checklist: (index: number) => string;
  reportNumberPrefix: (number: string) => string;
  reportNumberSuffix: (number: string) => string;
  deviationSuffix: string;
  approvedSuffix: string;
  serialPrefix: string;
  noSerial: string;
  approvedShort: string;
  deviationShort: string;
  technicianComment: string;
  signatureTechnician: string;
  signatureCustomer: string;
  footer: (companyName: string) => string;
  orderNumberPrefix: string;
  attachmentKicker: string;
  attachmentPosition: (index: number, total: number) => string;
  attachmentPoint: string;
  attachmentUnit: string;
  noUnit: string;
  attachmentSerial: (serial: string) => string;
  attachmentLocation: (location: string) => string;
  attachmentChecklist: string;
  attachmentComment: string;
  image: (index: number) => string;
};

const nb: PdfLabels = {
  documentTitle: "Servicerapport",
  hmsDocumentation: "HMS-dokumentasjon",
  hmsIncluded: "Inneholder HMS-dokumentasjon",
  hmsSuffix: "  •  HMS-dokumentasjon",
  companyFallback: "FSM System",
  answerYes: "Ja / utført",
  answerNo: "Nei / ikke krysset ut",
  answerUnanswered: "Ikke besvart",
  notSigned: "Ikke signert",
  lineComment: "» Kommentar",
  noImages: "Ingen bilder lagt ved",
  customer: "Kunde",
  workOrder: "Oppdrag",
  notSpecified: "Ikke angitt",
  statusPrefix: "Status:",
  unknownStatus: "Ukjent",
  datePrefix: "Dato:",
  noDate: "Ingen dato",
  technicianPrefix: "Utførende tekniker:",
  approved: "Godkjent / utført",
  deviationFound: "Avvik funnet",
  unknownResult: "Ukjent resultat",
  unitCount: (count) =>
    ` – ${count} ${count === 1 ? "enhet" : "enheter"} kontrollert`,
  checklist: (index) => `Sjekkliste ${index}`,
  reportNumberPrefix: (number) => `Rapportnr. ${number}`,
  reportNumberSuffix: (number) => `  •  Rapportnr. ${number}`,
  deviationSuffix: "  –  Avvik",
  approvedSuffix: "  –  Godkjent",
  serialPrefix: "SN:",
  noSerial: "Uten serienummer",
  approvedShort: "GODKJENT",
  deviationShort: "AVVIK",
  technicianComment: "Montørens kommentar",
  signatureTechnician: "Montør / tekniker",
  signatureCustomer: "Kunde",
  footer: (companyName) => `${companyName} – generert av FSM-plattformen`,
  orderNumberPrefix: "Ordrenr.",
  attachmentKicker: "Vedlegg – bilde",
  attachmentPosition: (index, total) => `${index} av ${total}`,
  attachmentPoint: "Sjekkpunkt:",
  attachmentUnit: "Enhet:",
  noUnit: "Uten enhet",
  attachmentSerial: (serial) => `  •  Serienummer: ${serial}`,
  attachmentLocation: (location) => `  •  Plassering: ${location}`,
  attachmentChecklist: "Sjekkliste:",
  attachmentComment: "Kommentar:",
  image: (index) => `Bilde ${index}`,
};

const en: PdfLabels = {
  documentTitle: "Service report",
  hmsDocumentation: "HSE documentation",
  hmsIncluded: "Contains HSE documentation",
  hmsSuffix: "  •  HSE documentation",
  companyFallback: "FSM System",
  answerYes: "Yes / completed",
  answerNo: "No / not checked",
  answerUnanswered: "Not answered",
  notSigned: "Not signed",
  lineComment: "» Comment",
  noImages: "No images attached",
  customer: "Customer",
  workOrder: "Work order",
  notSpecified: "Not specified",
  statusPrefix: "Status:",
  unknownStatus: "Unknown",
  datePrefix: "Date:",
  noDate: "No date",
  technicianPrefix: "Technician:",
  approved: "Approved / completed",
  deviationFound: "Deviation found",
  unknownResult: "Unknown result",
  unitCount: (count) =>
    ` – ${count} ${count === 1 ? "unit" : "units"} checked`,
  checklist: (index) => `Checklist ${index}`,
  reportNumberPrefix: (number) => `Report no. ${number}`,
  reportNumberSuffix: (number) => `  •  Report no. ${number}`,
  deviationSuffix: "  –  Deviation",
  approvedSuffix: "  –  Approved",
  serialPrefix: "SN:",
  noSerial: "No serial number",
  approvedShort: "APPROVED",
  deviationShort: "DEVIATION",
  technicianComment: "Technician comment",
  signatureTechnician: "Technician",
  signatureCustomer: "Customer",
  footer: (companyName) => `${companyName} – generated by the FSM platform`,
  orderNumberPrefix: "Order no.",
  attachmentKicker: "Attachment – image",
  attachmentPosition: (index, total) => `${index} of ${total}`,
  attachmentPoint: "Checkpoint:",
  attachmentUnit: "Unit:",
  noUnit: "No unit",
  attachmentSerial: (serial) => `  •  Serial number: ${serial}`,
  attachmentLocation: (location) => `  •  Location: ${location}`,
  attachmentChecklist: "Checklist:",
  attachmentComment: "Comment:",
  image: (index) => `Image ${index}`,
};

const LABELS: Record<string, PdfLabels> = { nb, en };

/** Henter PDF-etikettene for en locale. Ukjente locales faller tilbake til norsk. */
export function getPdfLabels(locale?: string | null): PdfLabels {
  const normalized = (locale ?? "").trim().toLowerCase();
  if (normalized.startsWith("en")) return en;
  return LABELS[normalized] ?? nb;
}

/** Norsk er standard for PDF-er, også når locale mangler. */
export const DEFAULT_PDF_LOCALE = "nb";
