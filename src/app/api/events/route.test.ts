import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string; role: string; isActive: boolean },
  acquire: vi.fn(() => true),
  release: vi.fn(),
  unsubscribe: vi.fn(),
  subscribe: vi.fn((_fn: (kind: string) => void) => mocks.unsubscribe),
}));

vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(async () => mocks.user),
  isStaff: (role?: string | null) =>
    role === "ADMIN" || role === "OFFICE" || role === "TECHNICIAN",
}));
vi.mock("@/lib/client-ip", () => ({
  clientIpFrom: () => "1.2.3.4",
}));
vi.mock("@/lib/realtime-hub", () => ({
  acquireRealtimeSlot: mocks.acquire,
  releaseRealtimeSlot: mocks.release,
  subscribeRealtime: mocks.subscribe,
}));

import { GET } from "./route";

function request() {
  return new Request("http://localhost:3000/api/events");
}

beforeEach(() => {
  mocks.user = null;
  mocks.acquire.mockReset();
  mocks.acquire.mockReturnValue(true);
  mocks.release.mockReset();
  mocks.unsubscribe.mockReset();
  mocks.subscribe.mockClear();
});

describe("/api/events", () => {
  it("avviser utloggede uten å reservere plass", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it("avviser kundeportalbrukere", async () => {
    mocks.user = { id: "c1", role: "CUSTOMER", isActive: true };
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.acquire).not.toHaveBeenCalled();
  });

  it("svarer 429 når brukeren har for mange strømmer", async () => {
    mocks.user = { id: "u1", role: "OFFICE", isActive: true };
    mocks.acquire.mockReturnValue(false);
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });

  it("åpner strøm for ansatte og frigir plassen ved avbrudd", async () => {
    mocks.user = { id: "u1", role: "TECHNICIAN", isActive: true };
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(mocks.acquire).toHaveBeenCalledWith({
      userId: "u1",
      ip: "1.2.3.4",
    });

    await response.body?.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
});
