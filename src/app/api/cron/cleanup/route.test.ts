import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cleanup = vi.hoisted(() =>
  vi.fn(async () => ({ checked: 3, released: 1 })),
);

vi.mock("@/lib/upload-cleanup", () => ({
  cleanupAbandonedUploads: cleanup,
}));

import { GET } from "./route";

const originalSecret = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  cleanup.mockResolvedValue({ checked: 3, released: 1 });
});

afterEach(() => {
  process.env.CRON_SECRET = originalSecret;
});

describe("/api/cron/cleanup", () => {
  it("avviser feil eller manglende bearer", async () => {
    const missing = await GET(new Request("http://localhost/api/cron/cleanup"));
    expect(missing.status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();

    const wrong = await GET(
      new Request("http://localhost/api/cron/cleanup", {
        headers: { authorization: "Bearer feil" },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  it("rydder forlatte opplastinger med riktig CRON_SECRET", async () => {
    const response = await GET(
      new Request("http://localhost/api/cron/cleanup", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      checked: 3,
      released: 1,
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("returnerer 503 når CRON_SECRET mangler", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(new Request("http://localhost/api/cron/cleanup"));
    expect(response.status).toBe(503);
    expect(cleanup).not.toHaveBeenCalled();
  });
});
