// i18n-ignore-file: påminnelses-e-post rendres i jobbworkeren utenfor
// request-locale og har derfor egne lokale tekster for nb/en/pl/de her.
import { formatDateLocalized } from "@/lib/dates";
import { smsLocale, type SmsLocale } from "@/lib/sms/templates";

export type ReminderMessageInput = {
  locale: string;
  contactName: string;
  customerName: string;
  companyName: string;
  workOrderTitle: string;
  start: Date;
  offsetHours: number;
  reference?: string | null;
};

export type ReminderMessageContent = {
  locale: SmsLocale;
  subject: string;
  body: string;
  date: string;
  time: string;
};

const TIMEZONE = "Europe/Oslo";

function formatTime(value: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale === "nb" ? "nb-NO" : locale, {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

/**
 * E-posttekst for påminnelser. SMS bruker de redigerbare malene i
 * `SmsTemplate`, mens e-post har en liten innebygd, lokalisert tekst. Den
 * inneholder ingen lenker eller kunde-ID-er utover det mottakeren allerede
 * kjenner.
 */
export function reminderEmailContent(
  input: ReminderMessageInput,
): ReminderMessageContent {
  const locale = smsLocale(input.locale);
  const date = formatDateLocalized(input.start, locale, {
    dateStyle: "medium",
  });
  const time = formatTime(input.start, locale);
  const name = input.contactName || input.customerName;
  const company = input.companyName || "";

  switch (locale) {
    case "en":
      return {
        locale,
        date,
        time,
        subject: `Reminder: ${input.workOrderTitle} on ${date}`,
        body: [
          `Hi ${name}!`,
          "",
          `This is a reminder about ${input.workOrderTitle} on ${date} at ${time}.`,
          "",
          "If the time no longer suits you, reply to this email or contact us.",
          "",
          company,
        ]
          .filter((line, index, lines) => line || index < lines.length - 1)
          .join("\n")
          .trim(),
      };
    case "pl":
      return {
        locale,
        date,
        time,
        subject: `Przypomnienie: ${input.workOrderTitle} — ${date}`,
        body: [
          `Cześć ${name}!`,
          "",
          `Przypominamy o ${input.workOrderTitle} dnia ${date} o ${time}.`,
          "",
          "Jeśli termin nie pasuje, odpowiedz na tę wiadomość lub skontaktuj się z nami.",
          "",
          company,
        ]
          .join("\n")
          .trim(),
      };
    case "de":
      return {
        locale,
        date,
        time,
        subject: `Erinnerung: ${input.workOrderTitle} am ${date}`,
        body: [
          `Hallo ${name}!`,
          "",
          `Dies ist eine Erinnerung an ${input.workOrderTitle} am ${date} um ${time}.`,
          "",
          "Falls der Termin nicht mehr passt, antworten Sie auf diese E-Mail oder kontaktieren Sie uns.",
          "",
          company,
        ]
          .join("\n")
          .trim(),
      };
    default:
      return {
        locale,
        date,
        time,
        subject: `Påminnelse: ${input.workOrderTitle} ${date}`,
        body: [
          `Hei ${name}!`,
          "",
          `Dette er en påminnelse om ${input.workOrderTitle} ${date} kl. ${time}.`,
          "",
          "Passer ikke tiden, svar på denne e-posten eller kontakt oss.",
          "",
          company,
        ]
          .join("\n")
          .trim(),
      };
  }
}
