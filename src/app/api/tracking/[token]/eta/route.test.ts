import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPublicTrackingEta: vi.fn(),
}));

vi.mock("@/server/tracking", () => ({
  getPublicTrackingEta: mocks.getPublicTrackingEta,
}));

import { GET } from "./route";

const TOKEN = "a".repeat(64);

function request() {
  return new Request(`http://localhost/api/tracking/${TOKEN}/eta`);
}

function context(token = TOKEN) {
  return { params: Promise.resolve({ token }) };
}

const snapshot = {
  status: "EN_ROUTE",
  etaSource: "live",
  etaMinutes: 12,
  estimatedArrivalAt: new Date("2026-11-03T10:12:00.000Z"),
  plannedStartsAt: new Date("2026-11-03T10:30:00.000Z"),
  lastUpdatedAt: new Date("2026-11-03T09:59:00.000Z"),
  pingAgeMinutes: 1,
  stale: false,
  hasLivePosition: true,
  travelProvider: "osrm",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPublicTrackingEta.mockResolvedValue({ ok: true, data: snapshot });
});

describe("GET /api/tracking/[token]/eta", () => {
  it("returnerer ETA uten personopplysninger og uten caching", async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    await expect(response.json()).resolves.toEqual({
      status: "EN_ROUTE",
      etaSource: "live",
      etaMinutes: 12,
      estimatedArrivalAt: "2026-11-03T10:12:00.000Z",
      plannedStartsAt: "2026-11-03T10:30:00.000Z",
      lastUpdatedAt: "2026-11-03T09:59:00.000Z",
      pingAgeMinutes: 1,
      stale: false,
      hasLivePosition: true,
      travelProvider: "osrm",
    });
    expect(mocks.getPublicTrackingEta).toHaveBeenCalledWith(TOKEN);
  });

  it("merker et gammelt ping som stale", async () => {
    mocks.getPublicTrackingEta.mockResolvedValue({
      ok: true,
      data: {
        ...snapshot,
        etaSource: "stale",
        etaMinutes: null,
        estimatedArrivalAt: null,
        pingAgeMinutes: 25,
        stale: true,
        hasLivePosition: false,
      },
    });

    const response = await GET(request(), context());
    const body = await response.json();

    expect(body.etaSource).toBe("stale");
    expect(body.stale).toBe(true);
    expect(body.etaMinutes).toBeNull();
    expect(body.hasLivePosition).toBe(false);
  });

  it("oversetter feil token til 404 uten cache", async () => {
    mocks.getPublicTrackingEta.mockResolvedValue({
      ok: false,
      reason: "invalid",
    });

    const response = await GET(request(), context("b".repeat(64)));

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returnerer 429 med Retry-After", async () => {
    mocks.getPublicTrackingEta.mockResolvedValue({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: 17,
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
  });
});
