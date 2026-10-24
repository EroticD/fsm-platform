import { describe, expect, it } from "vitest";
import {
  isNotificationRealtimeKind,
  shouldPlayNotificationSound,
} from "./notification-sound";

describe("shouldPlayNotificationSound", () => {
  it("er stille ved første innlasting", () => {
    expect(shouldPlayNotificationSound(null, 0)).toBe(false);
    expect(shouldPlayNotificationSound(null, 3)).toBe(false);
  });

  it("spiller når antallet øker", () => {
    expect(shouldPlayNotificationSound(0, 1)).toBe(true);
    expect(shouldPlayNotificationSound(2, 5)).toBe(true);
  });

  it("er stille når antallet er uendret eller synker", () => {
    expect(shouldPlayNotificationSound(3, 3)).toBe(false);
    expect(shouldPlayNotificationSound(5, 2)).toBe(false);
    expect(shouldPlayNotificationSound(1, 0)).toBe(false);
  });
});

describe("isNotificationRealtimeKind", () => {
  it("godtar varselhendelser", () => {
    expect(isNotificationRealtimeKind("notifications")).toBe(true);
    expect(isNotificationRealtimeKind("all")).toBe(true);
  });

  it("avviser andre eller manglende hendelser", () => {
    expect(isNotificationRealtimeKind("work-orders")).toBe(false);
    expect(isNotificationRealtimeKind(undefined)).toBe(false);
    expect(isNotificationRealtimeKind(null)).toBe(false);
  });
});
