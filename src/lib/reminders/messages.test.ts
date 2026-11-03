import { describe, expect, it } from "vitest";
import { reminderEmailContent } from "./messages";

const start = new Date("2026-07-01T10:00:00.000Z"); // 12:00 i Oslo

const base = {
  contactName: "Kari",
  customerName: "Kunde AS",
  companyName: "Bedriften",
  workOrderTitle: "Service på port",
  start,
  offsetHours: 24,
  reference: "O-1",
};

describe("påminnelses-e-post på fire språk", () => {
  it("lokaliserer norsk", () => {
    const content = reminderEmailContent({ ...base, locale: "nb" });
    expect(content.subject).toContain("Påminnelse");
    expect(content.body).toContain("Hei Kari!");
    expect(content.body).toContain("12:00");
    expect(content.body).toContain("Bedriften");
  });

  it("lokaliserer engelsk", () => {
    const content = reminderEmailContent({ ...base, locale: "en" });
    expect(content.subject).toContain("Reminder");
    expect(content.body).toContain("Hi Kari!");
    expect(content.body).toContain("12:00");
  });

  it("lokaliserer polsk", () => {
    const content = reminderEmailContent({ ...base, locale: "pl" });
    expect(content.subject).toContain("Przypomnienie");
    expect(content.body).toContain("Cześć Kari!");
  });

  it("lokaliserer tysk", () => {
    const content = reminderEmailContent({ ...base, locale: "de" });
    expect(content.subject).toContain("Erinnerung");
    expect(content.body).toContain("Hallo Kari!");
  });

  it("faller tilbake til norsk for ukjent språk", () => {
    const content = reminderEmailContent({ ...base, locale: "fr" });
    expect(content.locale).toBe("nb");
    expect(content.subject).toContain("Påminnelse");
  });
});
