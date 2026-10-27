import { describe, expect, it } from "vitest";
import {
  isSafeNotificationHref,
  notificationHrefForUser,
} from "./notification-links";

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

describe("isSafeNotificationHref", () => {
  it("godtar interne stier med søk og anker", () => {
    expect(isSafeNotificationHref("/oppdrag/wo1")).toBe(true);
    expect(isSafeNotificationHref("/kundeportal#rapporter")).toBe(true);
    expect(isSafeNotificationHref("/varsler?u=1&p=2")).toBe(true);
  });

  it("avviser eksterne, protokoll-relative og skjema-lenker", () => {
    expect(isSafeNotificationHref("https://example.test")).toBe(false);
    expect(isSafeNotificationHref("//example.test")).toBe(false);
    expect(isSafeNotificationHref("/\\example.test")).toBe(false);
    expect(isSafeNotificationHref("javascript:alert(1)")).toBe(false);
    expect(isSafeNotificationHref("")).toBe(false);
    expect(isSafeNotificationHref(null)).toBe(false);
  });
});
