// i18n-ignore-file: PDF-etiketter er lokale data keyet på språk. react-pdf har
// ikke tilgang til next-intl-konteksten, så alle fire språk ligger her.

export type ContractPdfLabels = {
  title: string;
  contractNumber: string;
  customer: string;
  orgNumber: string;
  phone: string;
  email: string;
  department: string;
  contact: string;
  period: string;
  noEndDate: string;
  interval: string;
  months: string;
  status: string;
  renewal: string;
  noticeDays: string;
  indexation: string;
  sla: string;
  slaResponse: string;
  slaResolution: string;
  businessHoursOnly: string;
  line: string;
  scope: string;
  equipment: string;
  allEquipment: string;
  visitsPerYear: string;
  responseMinutes: string;
  resolutionMinutes: string;
  priceList: string;
  code: string;
  label: string;
  unit: string;
  amount: string;
  referenceOnly: string;
  generated: string;
  statuses: Record<string, string>;
  renewalModes: Record<string, string>;
};

const LABELS: Record<string, ContractPdfLabels> = {
  nb: {
    title: "Serviceavtale",
    contractNumber: "Avtalenummer",
    customer: "Kunde",
    orgNumber: "Org.nr",
    phone: "Telefon",
    email: "E-post",
    department: "Avdeling",
    contact: "Kontaktperson",
    period: "Gyldighetsperiode",
    noEndDate: "Tidsubegrenset",
    interval: "Serviceintervall",
    months: "mnd",
    status: "Status",
    renewal: "Fornyelse",
    noticeDays: "Oppsigelsesfrist",
    indexation: "Prisjustering",
    sla: "SLA-policy",
    slaResponse: "Svartid",
    slaResolution: "Løsningstid",
    businessHoursOnly: "Bare innenfor åpningstid",
    line: "Dekning",
    scope: "Omfang",
    equipment: "Utstyr",
    allEquipment: "Alt utstyr",
    visitsPerYear: "Besøk per år",
    responseMinutes: "Svartid (min)",
    resolutionMinutes: "Løsningstid (min)",
    priceList: "Prisliste",
    code: "Kode",
    label: "Beskrivelse",
    unit: "Enhet",
    amount: "Beløp",
    referenceOnly:
      "Prislisten er referansedata for visning. Den brukes ikke til fakturering.",
    generated: "Generert",
    statuses: {
      DRAFT: "Utkast",
      ACTIVE: "Aktiv",
      PAUSED: "Pauset",
      EXPIRED: "Utløpt",
      TERMINATED: "Avsluttet",
    },
    renewalModes: { AUTO: "Automatisk", MANUAL: "Manuell" },
  },
  en: {
    title: "Service agreement",
    contractNumber: "Agreement number",
    customer: "Customer",
    orgNumber: "Org. no.",
    phone: "Phone",
    email: "Email",
    department: "Department",
    contact: "Contact",
    period: "Valid period",
    noEndDate: "No end date",
    interval: "Service interval",
    months: "months",
    status: "Status",
    renewal: "Renewal",
    noticeDays: "Notice period",
    indexation: "Price adjustment",
    sla: "SLA policy",
    slaResponse: "Response time",
    slaResolution: "Resolution time",
    businessHoursOnly: "Business hours only",
    line: "Coverage",
    scope: "Scope",
    equipment: "Equipment",
    allEquipment: "All equipment",
    visitsPerYear: "Visits per year",
    responseMinutes: "Response (min)",
    resolutionMinutes: "Resolution (min)",
    priceList: "Price list",
    code: "Code",
    label: "Description",
    unit: "Unit",
    amount: "Amount",
    referenceOnly:
      "The price list is reference data for display. It is not used for invoicing.",
    generated: "Generated",
    statuses: {
      DRAFT: "Draft",
      ACTIVE: "Active",
      PAUSED: "Paused",
      EXPIRED: "Expired",
      TERMINATED: "Terminated",
    },
    renewalModes: { AUTO: "Automatic", MANUAL: "Manual" },
  },
  pl: {
    title: "Umowa serwisowa",
    contractNumber: "Numer umowy",
    customer: "Klient",
    orgNumber: "NIP",
    phone: "Telefon",
    email: "E-mail",
    department: "Dział",
    contact: "Osoba kontaktowa",
    period: "Okres obowiązywania",
    noEndDate: "Bez daty końca",
    interval: "Interwał serwisowy",
    months: "mies.",
    status: "Status",
    renewal: "Odnowienie",
    noticeDays: "Okres wypowiedzenia",
    indexation: "Indeksacja cen",
    sla: "Polityka SLA",
    slaResponse: "Czas reakcji",
    slaResolution: "Czas rozwiązania",
    businessHoursOnly: "Tylko w godzinach pracy",
    line: "Zakres",
    scope: "Zakres usług",
    equipment: "Urządzenie",
    allEquipment: "Wszystkie urządzenia",
    visitsPerYear: "Wizyty rocznie",
    responseMinutes: "Reakcja (min)",
    resolutionMinutes: "Rozwiązanie (min)",
    priceList: "Cennik",
    code: "Kod",
    label: "Opis",
    unit: "Jednostka",
    amount: "Kwota",
    referenceOnly:
      "Cennik służy wyłącznie do wyświetlania. Nie jest używany do fakturowania.",
    generated: "Wygenerowano",
    statuses: {
      DRAFT: "Szkic",
      ACTIVE: "Aktywna",
      PAUSED: "Wstrzymana",
      EXPIRED: "Wygasła",
      TERMINATED: "Zakończona",
    },
    renewalModes: { AUTO: "Automatyczne", MANUAL: "Ręczne" },
  },
  de: {
    title: "Servicevertrag",
    contractNumber: "Vertragsnummer",
    customer: "Kunde",
    orgNumber: "Org.-Nr.",
    phone: "Telefon",
    email: "E-Mail",
    department: "Abteilung",
    contact: "Ansprechpartner",
    period: "Gültigkeitszeitraum",
    noEndDate: "Unbefristet",
    interval: "Serviceintervall",
    months: "Monate",
    status: "Status",
    renewal: "Verlängerung",
    noticeDays: "Kündigungsfrist",
    indexation: "Preisanpassung",
    sla: "SLA-Richtlinie",
    slaResponse: "Reaktionszeit",
    slaResolution: "Lösungszeit",
    businessHoursOnly: "Nur zu Geschäftszeiten",
    line: "Abdeckung",
    scope: "Umfang",
    equipment: "Gerät",
    allEquipment: "Alle Geräte",
    visitsPerYear: "Besuche pro Jahr",
    responseMinutes: "Reaktion (Min.)",
    resolutionMinutes: "Lösung (Min.)",
    priceList: "Preisliste",
    code: "Code",
    label: "Beschreibung",
    unit: "Einheit",
    amount: "Betrag",
    referenceOnly:
      "Die Preisliste dient nur zur Anzeige. Sie wird nicht zur Abrechnung verwendet.",
    generated: "Erstellt",
    statuses: {
      DRAFT: "Entwurf",
      ACTIVE: "Aktiv",
      PAUSED: "Pausiert",
      EXPIRED: "Abgelaufen",
      TERMINATED: "Beendet",
    },
    renewalModes: { AUTO: "Automatisch", MANUAL: "Manuell" },
  },
};

export function contractPdfLabels(locale?: string | null): ContractPdfLabels {
  const value = (locale ?? "nb").toLowerCase();
  const language = value.split("-")[0];
  return LABELS[language] ?? LABELS.nb;
}
