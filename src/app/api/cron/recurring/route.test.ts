import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/recurring-scheduler", () => ({
  runScheduledJobs: vi.fn(async () => ({
    recurring: [],
    lifecycle: { renewed: 0, expired: 0, generated: 0 },
    sla: { checked: 0, atRisk: 0, breached: 0, met: 0, notified: 0 },
  })),
}));

import { GET } from "./route";

const originalSecret = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
});
afterEach(() => {
  process.env.CRON_SECRET = originalSecret;
});

describe("/api/cron/recurring", () => {
  it("avviser feil eller manglende bearer", async () => {
    const missing = await GET(new Request("http://localhost:3000/api/cron/recurring"));
    expect(missing.status).toBe(401);

    const wrong = await GET(
      new Request("http://localhost:3000/api/cron/recurring", {
        headers: { authorization: "Bearer feil" },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  it("godtar riktig CRON_SECRET", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/cron/recurring", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, generated: 0 });
  });

  it("returnerer 503 når CRON_SECRET mangler", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(new Request("http://localhost:3000/api/cron/recurring"));
    expect(response.status).toBe(503);
  });
});
