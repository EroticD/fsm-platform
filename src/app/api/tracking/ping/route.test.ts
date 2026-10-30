import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  assertSameOrigin: vi.fn(() => true),
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  recordLocationPing: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/origin", () => ({ assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/server/tracking", () => ({
  recordLocationPing: mocks.recordLocationPing,
}));

import { POST } from "./route";

function user() {
  return {
    id: "tech-1",
    name: "Kari",
    email: "kari@example.test",
    role: "TECHNICIAN",
    isActive: true,
    departmentId: "dep-1",
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/tracking/ping", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const validBody = {
  visitId: "visit-1",
  latitude: 59.9139,
  longitude: 10.7522,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user());
  mocks.assertSameOrigin.mockReturnValue(true);
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.recordLocationPing.mockResolvedValue({
    ok: true,
    data: {
      id: "ping-1",
      recordedAt: new Date("2026-10-30T12:00:00.000Z"),
    },
  });
});

describe("POST /api/tracking/ping", () => {
  it("lagrer ping for innlogget bruker uten caching", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      recordedAt: "2026-10-30T12:00:00.000Z",
    });
    expect(mocks.recordLocationPing).toHaveBeenCalledWith(user(), validBody);
    expect(mocks.allowRequestDb).toHaveBeenCalledWith(
      "tracking-ping:tech-1",
      30,
      60_000,
    );
  });

  it("avviser uinnlogget bruker", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await POST(request(validBody));

    expect(response.status).toBe(401);
    expect(mocks.recordLocationPing).not.toHaveBeenCalled();
  });

  it("avviser feil origin", async () => {
    mocks.assertSameOrigin.mockReturnValue(false);

    const response = await POST(request(validBody));

    expect(response.status).toBe(403);
    expect(mocks.recordLocationPing).not.toHaveBeenCalled();
  });

  it("returnerer 429 med Retry-After", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 17,
    });

    const response = await POST(request(validBody));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(mocks.recordLocationPing).not.toHaveBeenCalled();
  });

  it("videresender ugyldig kropp som NaN til tjenesten", async () => {
    mocks.recordLocationPing.mockResolvedValue({
      ok: false,
      reason: "invalid",
      details: { code: "tracking.errors.invalidCoordinates" },
    });

    const response = await POST(
      request({ visitId: "visit-1", latitude: "90", longitude: 10 }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "ugyldig-data",
      code: "tracking.errors.invalidCoordinates",
    });
    expect(mocks.recordLocationPing).toHaveBeenCalledWith(user(), {
      visitId: "visit-1",
      latitude: NaN,
      longitude: 10,
    });
  });

  it("oversetter manglende eller feil visitt til 404", async () => {
    mocks.recordLocationPing.mockResolvedValue({
      ok: false,
      reason: "not_found",
    });

    const response = await POST(request(validBody));

    expect(response.status).toBe(404);
  });
});
