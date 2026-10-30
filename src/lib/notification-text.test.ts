import { describe, expect, it } from "vitest";
import {
  notificationBodyFor,
  notificationTitleFor,
  translateNotificationText,
} from "./notification-text";

describe("varseltekst fra nøkkel", () => {
  it("oversetter og fyller inn parametre", () => {
    expect(
      translateNotificationText("nb", "sms.notifications.title", {}),
    ).toBe("Ny SMS");
    expect(
      translateNotificationText("en", "sms.notifications.body", {
        preview: "Hei",
      }),
    ).toBe("Hei");
  });

  it("faller tilbake til norsk og deretter lagret tekst", () => {
    expect(
      notificationTitleFor(
        { title: "Lagret tekst", titleKey: "sms.notifications.title" },
        "pl",
      ),
    ).toBe("Nowy SMS");
    expect(
      notificationTitleFor({ title: "Bare tekst", titleKey: null }, "nb"),
    ).toBe("Bare tekst");
  });

  it("returnerer null når verken nøkkel eller tekst finnes", () => {
    expect(notificationBodyFor({ body: null }, "nb")).toBeNull();
  });
});
