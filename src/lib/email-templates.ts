// i18n-ignore-file: transaksjons-e-poster rendres utenfor request-locale og
// har derfor egne, lokaliserte kopier her. Alle felt escapes før HTML.
import { LIMITS, cleanColor, cleanText, escapeHtml } from "@/lib/sanitize";
import { neutralizeUrls } from "@/lib/neutralize-urls";
import type {
  EmailTemplateKey,
  EmailTemplatePayload,
} from "@/lib/email-events";

export const EMAIL_LOCALES = ["nb", "en", "pl", "de"] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

export function emailLocale(value: string | null | undefined): EmailLocale {
  return value === "en" || value === "pl" || value === "de" ? value : "nb";
}

export type EmailBranding = {
  companyName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

type Copy = {
  subjects: Record<EmailTemplateKey, string>;
  headings: Record<EmailTemplateKey, string>;
  intros: Record<EmailTemplateKey, string>;
  labels: {
    order: string;
    customer: string;
    reference: string;
    amount: string;
    dueDate: string;
    validUntil: string;
    date: string;
    time: string;
    technician: string;
    message: string;
  };
  openLink: string;
  footer: string;
  greeting: string;
};

const COPY: Record<EmailLocale, Copy> = {
  nb: {
    subjects: {
      quoteSent: "Tilbud: {title}",
      invoiceSent: "Faktura {reference}",
      paymentReceived: "Betaling mottatt – faktura {reference}",
      bookingRequested: "Vi har mottatt datoforespørselen din: {title}",
      bookingConfirmed: "Bookingen er bekreftet: {title}",
      bookingCancelled: "Bookingen er kansellert: {title}",
      workOrderAssigned: "Du er tildelt et oppdrag: {title}",
      test: "Test-e-post fra {company}",
    },
    headings: {
      quoteSent: "Tilbud",
      invoiceSent: "Faktura",
      paymentReceived: "Betaling mottatt",
      bookingRequested: "Datoforespørsel mottatt",
      bookingConfirmed: "Booking bekreftet",
      bookingCancelled: "Booking kansellert",
      workOrderAssigned: "Nytt oppdrag tildelt deg",
      test: "Test-e-post",
    },
    intros: {
      quoteSent:
        "Du har mottatt et tilbud fra {company}. Åpne lenken for å se detaljene og godkjenne.",
      invoiceSent:
        "Fakturaen er klar. Åpne den i kundeportalen for å se detaljer og betalingsinformasjon.",
      paymentReceived:
        "Vi har registrert betalingen på fakturaen. Denne e-posten er kvitteringen din.",
      bookingRequested:
        "Takk for forespørselen. Vi tar kontakt for å bekrefte dato og klokkeslett.",
      bookingConfirmed:
        "Tiden er bekreftet. Du finner detaljene for besøket nedenfor.",
      bookingCancelled:
        "Bookingen er kansellert. Ta kontakt med oss hvis dette ikke er riktig.",
      workOrderAssigned:
        "Du er satt som montør på oppdraget. Se detaljene i feltappen.",
      test: "Dette er en test fra e-postinnstillingene. SMTP og utboksen virker.",
    },
    labels: {
      order: "Oppdrag",
      customer: "Kunde",
      reference: "Referanse",
      amount: "Beløp",
      dueDate: "Forfallsdato",
      validUntil: "Gyldig til",
      date: "Dato",
      time: "Tid",
      technician: "Montør",
      message: "Melding",
    },
    openLink: "Åpne i FSM",
    footer: "Dette er en automatisk generert e-post fra",
    greeting: "Hei",
  },
  en: {
    subjects: {
      quoteSent: "Quote: {title}",
      invoiceSent: "Invoice {reference}",
      paymentReceived: "Payment received – invoice {reference}",
      bookingRequested: "We have received your date request: {title}",
      bookingConfirmed: "Your booking is confirmed: {title}",
      bookingCancelled: "Your booking is cancelled: {title}",
      workOrderAssigned: "You have been assigned a job: {title}",
      test: "Test e-mail from {company}",
    },
    headings: {
      quoteSent: "Quote",
      invoiceSent: "Invoice",
      paymentReceived: "Payment received",
      bookingRequested: "Date request received",
      bookingConfirmed: "Booking confirmed",
      bookingCancelled: "Booking cancelled",
      workOrderAssigned: "New job assigned to you",
      test: "Test e-mail",
    },
    intros: {
      quoteSent:
        "You have received a quote from {company}. Open the link to see the details and approve it.",
      invoiceSent:
        "The invoice is ready. Open it in the customer portal to see details and payment information.",
      paymentReceived:
        "We have registered the payment on the invoice. This e-mail is your receipt.",
      bookingRequested:
        "Thank you for your request. We will contact you to confirm the date and time.",
      bookingConfirmed:
        "The time is confirmed. You will find the visit details below.",
      bookingCancelled:
        "The booking has been cancelled. Please contact us if this is not correct.",
      workOrderAssigned:
        "You have been assigned as technician on the job. See the details in the field app.",
      test: "This is a test from the e-mail settings. SMTP and the outbox are working.",
    },
    labels: {
      order: "Job",
      customer: "Customer",
      reference: "Reference",
      amount: "Amount",
      dueDate: "Due date",
      validUntil: "Valid until",
      date: "Date",
      time: "Time",
      technician: "Technician",
      message: "Message",
    },
    openLink: "Open in FSM",
    footer: "This is an automatically generated e-mail from",
    greeting: "Hello",
  },
  pl: {
    subjects: {
      quoteSent: "Oferta: {title}",
      invoiceSent: "Faktura {reference}",
      paymentReceived: "Otrzymano płatność – faktura {reference}",
      bookingRequested: "Otrzymaliśmy Twoje zapytanie o termin: {title}",
      bookingConfirmed: "Rezerwacja potwierdzona: {title}",
      bookingCancelled: "Rezerwacja anulowana: {title}",
      workOrderAssigned: "Przydzielono Ci zlecenie: {title}",
      test: "Wiadomość testowa od {company}",
    },
    headings: {
      quoteSent: "Oferta",
      invoiceSent: "Faktura",
      paymentReceived: "Otrzymano płatność",
      bookingRequested: "Otrzymano zapytanie o termin",
      bookingConfirmed: "Rezerwacja potwierdzona",
      bookingCancelled: "Rezerwacja anulowana",
      workOrderAssigned: "Nowe zlecenie dla Ciebie",
      test: "Wiadomość testowa",
    },
    intros: {
      quoteSent:
        "Otrzymałeś ofertę od {company}. Otwórz link, aby zobaczyć szczegóły i zaakceptować.",
      invoiceSent:
        "Faktura jest gotowa. Otwórz ją w portalu klienta, aby zobaczyć szczegóły i informacje o płatności.",
      paymentReceived:
        "Zarejestrowaliśmy płatność na fakturze. Ta wiadomość jest Twoim potwierdzeniem.",
      bookingRequested:
        "Dziękujemy za zapytanie. Skontaktujemy się, aby potwierdzić datę i godzinę.",
      bookingConfirmed:
        "Termin został potwierdzony. Szczegóły wizyty znajdują się poniżej.",
      bookingCancelled:
        "Rezerwacja została anulowana. Skontaktuj się z nami, jeśli to pomyłka.",
      workOrderAssigned:
        "Przydzielono Ci zlecenie jako technikowi. Szczegóły znajdziesz w aplikacji terenowej.",
      test: "To jest test z ustawień e-mail. SMTP i skrzynka wychodząca działają.",
    },
    labels: {
      order: "Zlecenie",
      customer: "Klient",
      reference: "Referencja",
      amount: "Kwota",
      dueDate: "Termin płatności",
      validUntil: "Ważne do",
      date: "Data",
      time: "Godzina",
      technician: "Technik",
      message: "Wiadomość",
    },
    openLink: "Otwórz w FSM",
    footer: "To jest automatycznie wygenerowana wiadomość od",
    greeting: "Witaj",
  },
  de: {
    subjects: {
      quoteSent: "Angebot: {title}",
      invoiceSent: "Rechnung {reference}",
      paymentReceived: "Zahlung erhalten – Rechnung {reference}",
      bookingRequested: "Wir haben Ihre Terminanfrage erhalten: {title}",
      bookingConfirmed: "Ihre Buchung ist bestätigt: {title}",
      bookingCancelled: "Ihre Buchung wurde storniert: {title}",
      workOrderAssigned: "Ihnen wurde ein Auftrag zugewiesen: {title}",
      test: "Test-E-Mail von {company}",
    },
    headings: {
      quoteSent: "Angebot",
      invoiceSent: "Rechnung",
      paymentReceived: "Zahlung erhalten",
      bookingRequested: "Terminanfrage erhalten",
      bookingConfirmed: "Buchung bestätigt",
      bookingCancelled: "Buchung storniert",
      workOrderAssigned: "Neuer Auftrag für Sie",
      test: "Test-E-Mail",
    },
    intros: {
      quoteSent:
        "Sie haben ein Angebot von {company} erhalten. Öffnen Sie den Link, um die Details zu sehen und zuzustimmen.",
      invoiceSent:
        "Die Rechnung ist bereit. Öffnen Sie sie im Kundenportal, um Details und Zahlungsinformationen zu sehen.",
      paymentReceived:
        "Wir haben die Zahlung auf der Rechnung registriert. Diese E-Mail ist Ihre Quittung.",
      bookingRequested:
        "Vielen Dank für Ihre Anfrage. Wir melden uns, um Datum und Uhrzeit zu bestätigen.",
      bookingConfirmed:
        "Der Termin ist bestätigt. Die Details zum Besuch finden Sie unten.",
      bookingCancelled:
        "Die Buchung wurde storniert. Bitte kontaktieren Sie uns, falls dies nicht korrekt ist.",
      workOrderAssigned:
        "Sie wurden als Techniker für den Auftrag eingetragen. Details finden Sie in der Feld-App.",
      test: "Dies ist ein Test aus den E-Mail-Einstellungen. SMTP und der Postausgang funktionieren.",
    },
    labels: {
      order: "Auftrag",
      customer: "Kunde",
      reference: "Referenz",
      amount: "Betrag",
      dueDate: "Fälligkeitsdatum",
      validUntil: "Gültig bis",
      date: "Datum",
      time: "Zeit",
      technician: "Techniker",
      message: "Nachricht",
    },
    openLink: "In FSM öffnen",
    footer: "Dies ist eine automatisch generierte E-Mail von",
    greeting: "Hallo",
  },
};

function safePlain(value: unknown, maxLength: number = LIMITS.text): string {
  return cleanText(neutralizeUrls(cleanText(value, { maxLength })), {
    maxLength,
  });
}

function safeHtml(value: unknown, maxLength: number = LIMITS.text): string {
  return escapeHtml(safePlain(value, maxLength)).replace(/\n/g, "<br />");
}

function absoluteLink(value: unknown, baseUrl: string): string {
  const link = cleanText(value, { maxLength: LIMITS.line });
  if (!link) return "";
  try {
    const url = new URL(link, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function subjectFor(
  copy: Copy,
  template: EmailTemplateKey,
  values: { title: string; reference: string; company: string },
): string {
  return copy.subjects[template]
    .replace("{title}", values.title)
    .replace("{reference}", values.reference)
    .replace("{company}", values.company);
}

/**
 * Renderer en lokalisert transaksjons-e-post. Alle brukerstyrte felt går
 * gjennom `cleanText`, `neutralizeUrls` og `escapeHtml`, og systemets egne
 * lenker valideres som absolutte http(s)-URL-er.
 */
export function renderTransactionalEmail(input: {
  template: EmailTemplateKey;
  locale: string | null | undefined;
  payload: EmailTemplatePayload;
  branding: EmailBranding;
  baseUrl: string;
}): RenderedEmail {
  const copy = COPY[emailLocale(input.locale)];
  const payload = input.payload;
  const companyName = escapeHtml(
    cleanText(input.branding.companyName, { maxLength: LIMITS.title }) ||
      "FSM System",
  );
  const companyPlain = cleanText(input.branding.companyName, {
    maxLength: LIMITS.title,
  }) || "FSM System";
  const primaryColor = cleanColor(input.branding.primaryColor) || "#2563eb";
  const logoUrl = absoluteLink(input.branding.logoUrl, input.baseUrl);

  const title = safePlain(payload.title, LIMITS.title);
  const reference = safePlain(payload.reference, LIMITS.line);
  const customerName = safePlain(payload.customerName, LIMITS.title);
  const amount = safePlain(payload.amount, LIMITS.short);
  const dueDate = safePlain(payload.dueDate, LIMITS.short);
  const validUntil = safePlain(payload.validUntil, LIMITS.short);
  const date = safePlain(payload.date, LIMITS.short);
  const time = safePlain(payload.time, LIMITS.short);
  const technicianName = safePlain(payload.technicianName, LIMITS.title);
  const note = safePlain(payload.note, LIMITS.text);
  const link = absoluteLink(payload.link, input.baseUrl);

  const subject = subjectFor(copy, input.template, {
    title,
    reference,
    company: companyPlain,
  });

  const rows: Array<[string, string]> = [];
  if (title) rows.push([copy.labels.order, title]);
  if (customerName) rows.push([copy.labels.customer, customerName]);
  if (reference) rows.push([copy.labels.reference, reference]);
  if (amount) rows.push([copy.labels.amount, amount]);
  if (dueDate) rows.push([copy.labels.dueDate, dueDate]);
  if (validUntil) rows.push([copy.labels.validUntil, validUntil]);
  if (date) rows.push([copy.labels.date, time ? `${date} · ${time}` : date]);
  else if (time) rows.push([copy.labels.time, time]);
  if (technicianName) rows.push([copy.labels.technician, technicianName]);

  const detailRows = rows
    .map(
      ([label, value]) =>
        `<p style="margin:0 0 8px;"><strong>${escapeHtml(label)}:</strong> ${safeHtml(value)}</p>`,
    )
    .join("");

  const intro = copy.intros[input.template].replace(
    "{company}",
    companyName,
  );

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
      <div style="border-bottom: 2px solid ${primaryColor}; padding-bottom: 20px; margin-bottom: 24px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          ${
            logoUrl
              ? `<img src="${escapeHtml(logoUrl)}" alt="${companyName}" style="height: 32px; object-fit: contain;" />`
              : `<div style="width: 32px; height: 32px; background-color: ${primaryColor}; border-radius: 6px; display: inline-block; line-height: 32px; text-align: center; color: white; font-weight: bold; font-size: 14px;">${companyName.charAt(0).toUpperCase()}</div>`
          }
          <div>
            <h1 style="color: #1f2937; margin: 0; font-size: 20px;">${escapeHtml(
              copy.headings[input.template],
            )}</h1>
            <p style="color: #6b7280; font-size: 12px; margin: 0;">${companyName}</p>
          </div>
        </div>
      </div>
      <p style="color:#374151;font-size:14px;line-height:1.6;">${intro}</p>
      ${
        detailRows
          ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;color:#374151;font-size:14px;line-height:1.6;">${detailRows}</div>`
          : ""
      }
      ${
        note
          ? `<p style="color:#374151;font-size:14px;line-height:1.6;margin-top:16px;"><strong>${escapeHtml(
              copy.labels.message,
            )}:</strong><br />${safeHtml(note)}</p>`
          : ""
      }
      ${
        link
          ? `<p style="margin-top:24px;"><a href="${escapeHtml(link)}" style="background-color:${primaryColor};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:bold;font-size:14px;display:inline-block;">${escapeHtml(
              copy.openLink,
            )}</a></p><p style="word-break:break-all;color:${primaryColor};font-size:12px;">${escapeHtml(link)}</p>`
          : ""
      }
      <div style="margin-top:32px;text-align:center;font-size:11px;color:#9ca3af;">
        <p>${escapeHtml(copy.footer)} ${companyName}.</p>
      </div>
    </div>`;

  const textLines = [
    copy.headings[input.template],
    "",
    copy.intros[input.template].replace("{company}", companyPlain),
  ];
  for (const [label, value] of rows) textLines.push(`${label}: ${value}`);
  if (note) textLines.push(`${copy.labels.message}: ${note}`);
  if (link) textLines.push("", `${copy.openLink}: ${link}`);
  textLines.push("", `${copy.footer} ${companyPlain}.`);

  return {
    subject: cleanText(subject, { maxLength: LIMITS.title }),
    html,
    text: textLines.join("\n"),
  };
}
