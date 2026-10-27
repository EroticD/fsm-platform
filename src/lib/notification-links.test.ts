import { describe, expect, it } from "vitest";
import { notificationHrefForUser } from "./notification-links";

describe("notificationHrefForUser", () => {
  it("lar ansatte beholde oppdragslenken", () => {
    expect(
      notificationHrefForUser("TECHNICIAN", "REPORT_READY", "/mine-oppdrag/wo1"),
    ).toBe("/mine-oppdrag/wo1");
  });

  it("sender kundeportalbrukere til rapportdelen av portalen", () => {
    expect(
      notificationHrefForUser("CUSTOMER", "REPORT_READY", "/mine-oppdrag/wo1"),
    ).toBe("/kundeportal#rapporter");
    expect(
      notificationHrefForUser("CUSTOMER", "REPORT_READY", "/oppdrag/wo1"),
    ).toBe("/kundeportal#rapporter");
    expect(
      notificationHrefForUser("CUSTOMER", "REPORT_READY", "/rapporter/wo1"),
    ).toBe("/kundeportal#rapporter");
  });

  it("beholder kundeportallenker og tomme lenker", () => {
    // Rapportvarselet peker alltid til rapportdelen, selv om lagret lenke
    // skulle vært portalens forside.
    expect(
      notificationHrefForUser("CUSTOMER", "REPORT_READY", "/kundeportal"),
    ).toBe("/kundeportal#rapporter");
    expect(
      notificationHrefForUser("CUSTOMER", "BOOKING", "/kundeportal"),
    ).toBe("/kundeportal");
    expect(notificationHrefForUser("CUSTOMER", "REPORT_READY", null)).toBeNull();
  });
});
