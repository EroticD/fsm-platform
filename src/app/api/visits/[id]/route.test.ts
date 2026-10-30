import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(() => true),
  assertSameOrigin: vi.fn(() => true),
  allowRequestDb: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  moveVisit: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/permissions", () => ({ hasPermission: mocks.hasPermission }));
vi.mock("@/lib/origin", () => ({ assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/server/visits", () => ({ moveVisit: mocks.moveVisit }));

import { JSON_BODY_LIMIT } from "@/lib/request-body";
import { PATCH } from "./route";

const params = { params: Promise.resolve({ id: "visit-1" }) };

function user() {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: null,
  };
}

function request(
  body: BodyInit | ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
) {
  const stream = body instanceof ReadableStream ? { duplex: "half" as const } : {};
  return new Request("http://localhost/api/visits/visit-1", {
    method: "PATCH",
    body,
    ...stream,
    headers,
  } as RequestInit);
}

function jsonRequest(body: unknown) {
  return request(JSON.stringify(body), {
    "content-type": "application/json",
  });
}

function chunkedBody(totalBytes: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(1024));
      sent += 1024;
    },
  });
}

const validBody = {
  startsAt: "2026-10-19T07:00:00.000Z",
  endsAt: "2026-10-19T09:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user());
  mocks.hasPermission.mockReturnValue(true);
  mocks.assertSameOrigin.mockReturnValue(true);
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.moveVisit.mockResolvedValue({
    ok: true,
    data: {
      id: "visit-1",
      startsAt: new Date(validBody.startsAt),
      endsAt: new Date(validBody.endsAt),
    },
  });
});

describe("PATCH /api/visits/[id]", () => {
  it("flytter visitten med ISO-tidspunkt og innlogget aktør", async () => {
    const response = await PATCH(jsonRequest(validBody), params);

    expect(response.status).toBe(200);
    expect(mocks.moveVisit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "visit-1",
      {
        startsAt: new Date(validBody.startsAt),
        endsAt: new Date(validBody.endsAt),
      },
    );
    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "workorders.assign",
    );
  });

  it("avviser uinnlogget bruker med 401", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await PATCH(jsonRequest(validBody), params);

    expect(response.status).toBe(401);
    expect(mocks.moveVisit).not.toHaveBeenCalled();
  });

  it("avviser bruker uten workorders.assign med 403", async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await PATCH(jsonRequest(validBody), params);

    expect(response.status).toBe(403);
    expect(mocks.moveVisit).not.toHaveBeenCalled();
  });

  it("avviser feil origin med 403", async () => {
    mocks.assertSameOrigin.mockReturnValue(false);

    const response = await PATCH(jsonRequest(validBody), params);

    expect(response.status).toBe(403);
    expect(mocks.moveVisit).not.toHaveBeenCalled();
  });

  it("oversetter manglende visitt til 404", async () => {
    mocks.moveVisit.mockResolvedValue({ ok: false, reason: "not_found" });

    const response = await PATCH(jsonRequest(validBody), params);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("ikke-funnet");
  });

  it("returnerer 409 med overlappkode og konflikter", async () => {
    mocks.moveVisit.mockResolvedValue({
      ok: false,
      reason: "conflict",
      details: {
        code: "visits.errors.overlap",
        conflicts: [
          {
            visitId: "visit-2",
            workOrderId: "wo-2",
            startsAt: "2026-10-19T07:30:00.000Z",
            endsAt: "2026-10-19T08:30:00.000Z",
            technicianIds: ["tech-1"],
          },
        ],
      },
    });

    const response = await PATCH(jsonRequest(validBody), params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "konflikt",
      code: "visits.errors.overlap",
    });
    expect(body.conflicts).toHaveLength(1);
  });

  it("avviser ugyldig tidsrom før tjenesten kalles", async () => {
    const response = await PATCH(
      jsonRequest({
        startsAt: "2026-10-19T09:00:00.000Z",
        endsAt: "2026-10-19T09:00:00.000Z",
      }),
      params,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("visits.errors.invalidTimeRange");
    expect(mocks.moveVisit).not.toHaveBeenCalled();
  });

  it("avviser ikke-ISO-tidspunkt", async () => {
    const response = await PATCH(
      jsonRequest({ startsAt: "i morgen", endsAt: "senere" }),
      params,
    );

    expect(response.status).toBe(400);
    expect(mocks.moveVisit).not.toHaveBeenCalled();
  });

  it("avviser Content-Length over grensen før parsing", async () => {
    const response = await PATCH(
      request("{}", {
        "content-type": "application/json",
        "content-length": String(JSON_BODY_LIMIT + 1),
      }),
      params,
    );

    expect(response.status).toBe(413);
    expect(mocks.moveVisit).not.toHaveBeenCalled();
  });

  it("avviser chunked kropp over grensen", async () => {
    const response = await PATCH(
      request(chunkedBody(JSON_BODY_LIMIT + 1024), {
        "content-type": "application/json",
      }),
      params,
    );

    expect(response.status).toBe(413);
    expect(mocks.moveVisit).not.toHaveBeenCalled();
  });

  it("rate-limiter før kroppen leses", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 9,
    });

    const response = await PATCH(
      request(chunkedBody(JSON_BODY_LIMIT * 2), {
        "content-type": "application/json",
      }),
      params,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("9");
    expect(mocks.moveVisit).not.toHaveBeenCalled();
  });
});
