import { describe, expect, it } from "vitest";
import {
  emailLocale,
  renderTransactionalEmail,
} from "./email-templates";

const branding = {
  companyName: "Kunde & Sønn AS",
  primaryColor: "#123456",
};

describe("renderTransactionalEmail", () => {
  it("lokaliserer emne og innhold for nb, en, pl og de", () => {
    const base = {
      template: "invoiceSent" as const,
      payload: { reference: "F-100", amount: "1 250,00 kr", link: "/kundeportal" },
      branding,
      baseUrl: "https://fsm.example",
    };

    expect(renderTransactionalEmail({ ...base, locale: "nb" }).subject).toContain(
      "Faktura F-100",
    );
    expect(renderTransactionalEmail({ ...base, locale: "en" }).subject).toContain(
      "Invoice F-100",
    );
    expect(renderTransactionalEmail({ ...base, locale: "pl" }).subject).toContain(
      "Faktura F-100",
    );
    expect(renderTransactionalEmail({ ...base, locale: "de" }).subject).toContain(
      "Rechnung F-100",
    );
    expect(
      renderTransactionalEmail({ ...base, locale: "en" }).html,
    ).toContain("Invoice");
    expect(
      renderTransactionalEmail({ ...base, locale: "de" }).html,
    ).toContain("Rechnung");
  });

  it("ukjent språk faller tilbake til norsk", () => {
    expect(emailLocale("fr")).toBe("nb");
    expect(emailLocale(null)).toBe("nb");
    expect(emailLocale("en")).toBe("en");
  });

  it("escaper HTML og nøytraliserer lenker i alle brukerfelt", () => {
    const rendered = renderTransactionalEmail({
      template: "quoteSent",
      locale: "nb",
      payload: {
        title: "5 < 10 & service <script>alert(1)</script>",
        customerName: "Kari & Sønn <b>Kunde</b>",
        reference: "T-1 https://phish.test",
        note: "Gå til www.evil.test",
        link: "/tilbud/godkjenn/token",
      },
      branding,
      baseUrl: "https://fsm.example",
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).not.toContain("<b>Kunde</b>");
    expect(rendered.html).not.toContain("phish.test");
    expect(rendered.html).not.toContain("evil.test");
    expect(rendered.html).toContain("5 &lt; 10 &amp; service");
    expect(rendered.html).toContain("Kari &amp; Sønn Kunde");
    expect(rendered.html).toContain("[lenke fjernet]");
    expect(rendered.subject).not.toContain("phish.test");
    expect(rendered.text).not.toContain("evil.test");
  });

  it("gjør systemlenker absolutte og avviser javascript-URL-er", () => {
    const rendered = renderTransactionalEmail({
      template: "bookingConfirmed",
      locale: "en",
      payload: {
        title: "Service",
        link: "/kundeportal/bestillinger",
      },
      branding,
      baseUrl: "https://fsm.example",
    });

    expect(rendered.html).toContain(
      'href="https://fsm.example/kundeportal/bestillinger"',
    );

    const unsafe = renderTransactionalEmail({
      template: "bookingConfirmed",
      locale: "en",
      payload: {
        title: "Service",
        link: "javascript:alert(1)",
      },
      branding,
      baseUrl: "https://fsm.example",
    });
    expect(unsafe.html).not.toContain("javascript:");
  });

  it("behandler ukjent payload-form uten å kaste", () => {
    const rendered = renderTransactionalEmail({
      template: "test",
      locale: "nb",
      payload: {},
      branding,
      baseUrl: "https://fsm.example",
    });
    expect(rendered.subject).toContain("Test-e-post");
    expect(rendered.html).toContain("SMTP");
  });
});
