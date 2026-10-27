import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPE_PRESENTATION,
  notificationSourceText,
  notificationTypePresentation,
} from "@/lib/notification-display";

describe("notificationTypePresentation", () => {
  it("gir kort etikett, ikon og tone for alle kjente typer", () => {
    const types = [
      "ASSIGNMENT",
      "DATE_CHANGED",
      "CANCELLED",
      "REPORT_READY",
      "BOOKING",
      "CONTRACT_DUE",
      "OVERDUE",
      "CONTACT_UPDATE",
    ];

    for (const type of types) {
      const presentation = notificationTypePresentation(type);
      expect(presentation).not.toBeNull();
      expect(presentation?.labelKey).toBe(`p3.notifications.types.${type}`);
      expect(presentation?.icon.length).toBeGreaterThan(0);
      expect(presentation?.tone.length).toBeGreaterThan(0);
    }
    expect(Object.keys(NOTIFICATION_TYPE_PRESENTATION)).toHaveLength(types.length);
  });

  it("returnerer null for ukjente typer", () => {
    expect(notificationTypePresentation("SOMETHING_NEW")).toBeNull();
  });
});

describe("notificationSourceText", () => {
  it("bruker sourceLabel når den finnes", () => {
    expect(
      notificationSourceText("Oppdrag: testoppdrag · Biniam", "Systemvarsel"),
    ).toBe("Oppdrag: testoppdrag · Biniam");
  });

  it("trimmer kilden", () => {
    expect(notificationSourceText("  Kunde: Pipelife  ", "Systemvarsel")).toBe(
      "Kunde: Pipelife",
    );
  });

  it("faller tilbake for tomme og manglende kilder", () => {
    expect(notificationSourceText(null, "Systemvarsel")).toBe("Systemvarsel");
    expect(notificationSourceText(undefined, "Systemvarsel")).toBe(
      "Systemvarsel",
    );
    expect(notificationSourceText("   ", "Systemvarsel")).toBe("Systemvarsel");
  });
});
