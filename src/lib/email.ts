import nodemailer from "nodemailer";
import prisma from "@/lib/prisma";
import { LIMITS, cleanColor, cleanText, cleanUrl, escapeHtml } from "@/lib/sanitize";
import { formatDate } from "@/lib/dates";

/** Er SMTP konfigurert i .env? */
function isSmtpConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Begrens ventetiden slik at en feilkonfigurert SMTP ikke blokkerer UI-en lenge.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  });
}

export async function sendWorkOrderReport(
  customerEmail: string,
  workOrder: any,
  checklistData: Record<string, any>,
  comments: string,
  signatureName: string
) {
  // Henter global merkevare for e-post-malen
  const branding = await prisma.branding.findFirst();
  // Verdiene brukes inne i HTML, så de vaskes og escapes før de settes inn.
  const primaryColor = cleanColor(branding?.primaryColor) || "#2563eb";
  const logoUrl = cleanUrl(branding?.logoUrl);
  const companyName = escapeHtml(cleanText(branding?.companyName, { maxLength: LIMITS.title }) || "FSM System");

  // Sjekker om e-post er konfigurert i .env
  if (!isSmtpConfigured()) {
    console.warn("⚠️ Mangler SMTP-variabler i .env. E-post ble simulert, men ikke sendt.");
    return;
  }

  const transporter = createTransporter();

  // Bygger en profesjonell HTML-rapport med global merkevare
  const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: 0 auto; padding: 30px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
      
      <div style="border-bottom: 2px solid ${primaryColor}; padding-bottom: 20px; margin-bottom: 30px;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
          ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="height: 32px; object-fit: contain;" />` : `<div style="width: 32px; height: 32px; background-color: ${primaryColor}; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px;">${companyName.charAt(0).toUpperCase()}</div>`}
          <div>
            <h1 style="color: #1f2937; margin: 0; font-size: 24px;">Servicerapport</h1>
            <p style="color: #6b7280; font-size: 12px; margin: 0;">${companyName}</p>
          </div>
        </div>
        <p style="color: #6b7280; font-size: 14px; margin-top: 5px;">Oppdrags-ID: #${escapeHtml(workOrder.id.slice(-6).toUpperCase())}</p>
      </div>

      <table style="width: 100%; margin-bottom: 30px; font-size: 14px;">
        <tr>
          <td style="padding-bottom: 10px;"><strong>Kunde:</strong><br/>${escapeHtml(workOrder.customer.name)}</td>
          <td style="padding-bottom: 10px;"><strong>Dato for utførelse:</strong><br/>${formatDate(new Date())}</td>
        </tr>
        <tr>
          <td><strong>Oppdragstittel:</strong><br/>${escapeHtml(workOrder.title)}</td>
          <td><strong>Utført av:</strong><br/>${workOrder.technicians.map((t: any) => escapeHtml(t.name)).join(", ")}</td>
        </tr>
      </table>

      <h3 style="color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px;">Gjennomført Sjekkliste</h3>
      <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; margin-bottom: 30px;">
        <thead>
          <tr style="background-color: #f3f4f6;">
            <th style="padding: 12px 15px; border-radius: 8px 0 0 8px;">Sjekkpunkt</th>
            <th style="padding: 12px 15px;">Status</th>
            <th style="padding: 12px 15px; border-radius: 0 8px 8px 0;">Kommentar</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(checklistData).map(([label, data]: any) => `
            <tr>
              <td style="padding: 12px 15px; border-bottom: 1px solid #f3f4f6;">${escapeHtml(label)}</td>
              <td style="padding: 12px 15px; border-bottom: 1px solid #f3f4f6; font-weight: bold; color: ${data.status ? '#16a34a' : '#dc2626'};">
                ${data.status ? '✅ OK' : '❌ Avvik'}
              </td>
              <td style="padding: 12px 15px; border-bottom: 1px solid #f3f4f6; color: #4b5563;">
                ${escapeHtml(data.comment) || "-"}${data.photoUrl ? '<br/><span style="font-size: 10px; color: ${primaryColor};">(Bilde vedlagt i systemet)</span>' : ''}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 30px; border: 1px solid #e2e8f0;">
        <h3 style="margin-top: 0; color: #334155; font-size: 16px;">Montørens sluttkommentar</h3>
        <p style="color: #475569; margin-bottom: 0; line-height: 1.5;">${escapeHtml(comments) || "Ingen kommentar."}</p>
      </div>

      <div style="margin-top: 30px;">
        <h3 style="color: #374151; font-size: 16px; margin-bottom: 5px;">Kundesignatur</h3>
        <p style="color: #111827; font-weight: bold; font-size: 18px; font-family: 'Brush Script MT', cursive, sans-serif; margin-top: 5px;">
          ${escapeHtml(signatureName) || "Ikke signert"}
        </p>
        <p style="font-size: 11px; color: #9ca3af;">Signert digitalt på lokasjon.</p>
      </div>

      <div style="margin-top: 40px; text-align: center; font-size: 11px; color: #9ca3af;">
        <p>Dette er en automatisk generert servicerapport fra ${companyName}.</p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"${companyName}" <${process.env.SMTP_USER}>`,
      to: customerEmail,
      subject: `Servicerapport - ${escapeHtml(workOrder.title)}`,
      html: htmlContent,
    });
    console.log("✅ E-post sendt til", customerEmail);
  } catch (error) {
    console.error("❌ Feil ved sending av e-post:", error);
  }
}

/**
 * Sender en invitasjonslenke til en ny bruker, slik at de kan sette eget passord.
 * Returnerer true hvis e-posten faktisk ble sendt, false hvis SMTP mangler eller sending feilet.
 */
export async function sendInviteEmail(
  to: string,
  name: string | null | undefined,
  inviteUrl: string
): Promise<boolean> {
  const branding = await prisma.branding.findFirst();
  // Verdiene brukes inne i HTML, så de vaskes og escapes før de settes inn.
  const primaryColor = cleanColor(branding?.primaryColor) || "#2563eb";
  const logoUrl = cleanUrl(branding?.logoUrl);
  const companyName = escapeHtml(cleanText(branding?.companyName, { maxLength: LIMITS.title }) || "FSM System");

  if (!isSmtpConfigured()) {
    console.warn("⚠️ Mangler SMTP-variabler i .env. Invitasjons-e-post ble ikke sendt.");
    return false;
  }

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
      <div style="border-bottom: 2px solid ${primaryColor}; padding-bottom: 20px; margin-bottom: 30px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="height: 32px; object-fit: contain;" />` : `<div style="width: 32px; height: 32px; background-color: ${primaryColor}; border-radius: 6px; display: inline-block; line-height: 32px; text-align: center; color: white; font-weight: bold; font-size: 14px;">${companyName.charAt(0).toUpperCase()}</div>`}
          <div>
            <h1 style="color: #1f2937; margin: 0; font-size: 22px;">Velkommen!</h1>
            <p style="color: #6b7280; font-size: 12px; margin: 0;">${companyName}</p>
          </div>
        </div>
      </div>

      <p style="color: #374151; font-size: 15px; line-height: 1.6;">
        Hei${name ? ` ${escapeHtml(name.split(" ")[0])}` : ""},<br/>
        det er opprettet en konto til deg hos ${companyName}. Klikk på knappen under for å sette ditt eget passord.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${escapeHtml(inviteUrl)}" style="background-color: ${primaryColor}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: bold; font-size: 15px; display: inline-block;">
          Sett passord
        </a>
      </div>

      <p style="color: #6b7280; font-size: 13px; line-height: 1.6;">
        Lenken er gyldig i 7 dager. Hvis knappen ikke virker, kopier denne adressen inn i nettleseren:
      </p>
      <p style="word-break: break-all; color: ${primaryColor}; font-size: 12px;">${escapeHtml(inviteUrl)}</p>

      <p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin-top: 24px;">
        Etter at du har satt passordet må kontoen aktiveres av en administrator før du kan logge inn.
      </p>

      <div style="margin-top: 40px; text-align: center; font-size: 11px; color: #9ca3af;">
        <p>Dette er en automatisk generert e-post fra ${companyName}.</p>
      </div>
    </div>
  `;

  const transporter = createTransporter();

  try {
    await transporter.sendMail({
      from: `"${companyName}" <${process.env.SMTP_USER}>`,
      to,
      subject: `Velkommen til ${companyName} – sett ditt passord`,
      html: htmlContent,
    });
    console.log("✅ Invitasjons-e-post sendt til", to);
    return true;
  } catch (error) {
    console.error("❌ Feil ved sending av invitasjons-e-post:", error);
    return false;
  }
}

type BookingInfo = {
  title: string;
  description?: string | null;
  customerName: string;
  bookedBy: string;
};

/**
 * Varsler kontoret om en ny kundebestilling, og sender en bekreftelse til
 * kunden. Returnerer hvor mange e-poster som ble sendt.
 */
export async function sendBookingNotification(
  officeRecipients: string[],
  customerEmail: string | null | undefined,
  booking: BookingInfo,
): Promise<{ officeSent: number; customerSent: boolean }> {
  if (!isSmtpConfigured()) return { officeSent: 0, customerSent: false };

  const branding = await prisma.branding.findFirst();
  const primaryColor = cleanColor(branding?.primaryColor) || "#2563eb";
  const logoUrl = cleanUrl(branding?.logoUrl);
  const companyName = escapeHtml(cleanText(branding?.companyName, { maxLength: LIMITS.title }) || "FSM System");
  const transporter = createTransporter();

  const safeTitle = escapeHtml(booking.title);
  const safeCustomer = escapeHtml(booking.customerName);
  const safeBookedBy = escapeHtml(booking.bookedBy);
  const safeDescription = booking.description ? escapeHtml(booking.description) : "";

  const shell = (heading: string, body: string) => `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
      <div style="border-bottom: 2px solid ${primaryColor}; padding-bottom: 20px; margin-bottom: 24px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          ${logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="height: 32px; object-fit: contain;" />` : `<div style="width: 32px; height: 32px; background-color: ${primaryColor}; border-radius: 6px; display: inline-block; line-height: 32px; text-align: center; color: white; font-weight: bold; font-size: 14px;">${companyName.charAt(0).toUpperCase()}</div>`}
          <div>
            <h1 style="color: #1f2937; margin: 0; font-size: 20px;">${heading}</h1>
            <p style="color: #6b7280; font-size: 12px; margin: 0;">${companyName}</p>
          </div>
        </div>
      </div>
      ${body}
      <div style="margin-top: 32px; text-align: center; font-size: 11px; color: #9ca3af;">
        <p>Dette er en automatisk generert e-post fra ${companyName}.</p>
      </div>
    </div>`;

  const detail = `
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:16px;color:#374151;font-size:14px;line-height:1.6;">
      <p style="margin:0 0 8px;"><strong>Oppdrag:</strong> ${safeTitle}</p>
      <p style="margin:0 0 8px;"><strong>Kunde:</strong> ${safeCustomer}</p>
      <p style="margin:0 0 8px;"><strong>Booket av:</strong> ${safeBookedBy}</p>
      ${safeDescription ? `<p style="margin:0;"><strong>Beskrivelse:</strong><br/>${safeDescription.replace(/\n/g, "<br/>")}</p>` : ""}
    </div>`;

  let officeSent = 0;
  const recipients = Array.from(new Set(officeRecipients.filter(Boolean)));
  if (recipients.length > 0) {
    try {
      await transporter.sendMail({
        from: `"${companyName}" <${process.env.SMTP_USER}>`,
        to: recipients.join(", "),
        subject: `Ny bestilling: ${safeTitle} – ${safeCustomer}`,
        html: shell(
          "Ny bestilling fra kundeportal",
          `<p style="color:#374151;font-size:14px;line-height:1.6;">En kunde har booket et nytt oppdrag. Det ligger klart for planlegging under «Oppdrag».</p>${detail}`,
        ),
      });
      officeSent = recipients.length;
    } catch (error) {
      console.error("❌ Feil ved sending av bestillingsvarsel til kontoret:", error);
    }
  }

  let customerSent = false;
  if (customerEmail) {
    try {
      await transporter.sendMail({
        from: `"${companyName}" <${process.env.SMTP_USER}>`,
        to: customerEmail,
        subject: `Vi har mottatt bestillingen din: ${safeTitle}`,
        html: shell(
          "Bestilling mottatt",
          `<p style="color:#374151;font-size:14px;line-height:1.6;">Takk for bestillingen. Vi tar kontakt for å avtale dato.</p>${detail}`,
        ),
      });
      customerSent = true;
    } catch (error) {
      console.error("❌ Feil ved sending av bestillingsbekreftelse:", error);
    }
  }

  return { officeSent, customerSent };
}
