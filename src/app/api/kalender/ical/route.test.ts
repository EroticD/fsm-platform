import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCalendarFeed: vi.fn(),
}));

vi.mock("@/server/calendar-feed", () => ({
  getCalendarFeed: mocks.getCalendarFeed,
}));

import { GET } from "./route";

const headers = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/kalender/ical", () => {
  it("returnerer 401 for ukjent eller tilbakekalt token", async () => {
    mocks.getCalendarFeed.mockResolvedValue({ ok: false, reason: "invalid" });

    const response = await GET(
      new Request("http://localhost:3000/api/kalender/ical?token=abc"),
    );

    expect(response.status).toBe(401);
    expect(mocks.getCalendarFeed).toHaveBeenCalledWith("abc");
    for (const [key, value] of Object.entries(headers)) {
      expect(response.headers.get(key)).toBe(value);
    }
  });

  it("returnerer 429 med Retry-After når rate limit er nådd", async () => {
    mocks.getCalendarFeed.mockResolvedValue({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: 42,
    });

    const response = await GET(
      new Request("http://localhost:3000/api/kalender/ical?token=abc"),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    for (const [key, value] of Object.entries(headers)) {
      expect(response.headers.get(key)).toBe(value);
    }
  });

  it("returnerer kalenderen med sikkerhetsheadere", async () => {
    mocks.getCalendarFeed.mockResolvedValue({
      ok: true,
      feed: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    });

    const response = await GET(
      new Request("http://localhost:3000/api/kalender/ical?token=abc"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(await response.text()).toContain("BEGIN:VCALENDAR");
    for (const [key, value] of Object.entries(headers)) {
      expect(response.headers.get(key)).toBe(value);
    }
  });

  it("sender tomt token videre uten å kaste", async () => {
    mocks.getCalendarFeed.mockResolvedValue({ ok: false, reason: "invalid" });

    const response = await GET(
      new Request("http://localhost:3000/api/kalender/ical"),
    );

    expect(response.status).toBe(401);
    expect(mocks.getCalendarFeed).toHaveBeenCalledWith("");
  });
});
