import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(async () => []),
    documentJob: { count: vi.fn(async () => 0) },
  },
}));
vi.mock("node:fs/promises", () => ({
  default: { mkdir: vi.fn(async () => undefined), access: vi.fn(async () => undefined) },
}));
vi.mock("@/lib/uploads", () => ({ uploadDir: () => "/tmp/uploads" }));

import { GET } from "./route";

const originalReady = process.env.READY_SECRET;
const originalCron = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.READY_SECRET = "ready-secret";
  process.env.CRON_SECRET = "cron-secret";
});
afterEach(() => {
  process.env.READY_SECRET = originalReady;
  process.env.CRON_SECRET = originalCron;
});

describe("/api/ready", () => {
  it("returnerer bare status uten hemmelighet", async () => {
    const response = await GET(new Request("http://localhost:3000/api/ready"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
  });

  it("returnerer detaljer med gyldig READY_SECRET", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/ready", {
        headers: { authorization: "Bearer ready-secret" },
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      status: "ready",
      database: "up",
      disk: "writable",
      queue: { pending: 0, failed: 0 },
    });
    expect(body.requestId).toBeTruthy();
  });

  it("avviser feil hemmelighet uten detaljer", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/ready", {
        headers: { authorization: "Bearer feil" },
      }),
    );
    await expect(response.json()).resolves.toEqual({ status: "ready" });
  });
});
