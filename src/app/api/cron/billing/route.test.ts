import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moduleEnabled: vi.fn(),
  expireQuotes: vi.fn(async () => 2),
  markOverdueInvoices: vi.fn(async () => 3),
}));

vi.mock("@/server/modules", () => ({ moduleEnabled: mocks.moduleEnabled }));
vi.mock("@/server/quotes", () => ({ expireQuotes: mocks.expireQuotes }));
vi.mock("@/server/invoices", () => ({ markOverdueInvoices: mocks.markOverdueInvoices }));

import { GET } from "./route";

const originalSecret = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "cron-secret";
  mocks.moduleEnabled.mockResolvedValue(true);
  mocks.expireQuotes.mockClear();
  mocks.markOverdueInvoices.mockClear();
});

afterEach(() => {
  process.env.CRON_SECRET = originalSecret;
});

describe("/api/cron/billing", () => {
  it("avviser manglende eller feil hemmelighet", async () => {
    const missing = await GET(new Request("http://localhost/api/cron/billing"));
    expect(missing.status).toBe(401);
    const wrong = await GET(
      new Request("http://localhost/api/cron/billing", {
        headers: { authorization: "Bearer feil" },
      }),
    );
    expect(wrong.status).toBe(401);
    expect(mocks.expireQuotes).not.toHaveBeenCalled();
  });

  it("kjører begge idempotente jobbene når modulene er på", async () => {
    const response = await GET(
      new Request("http://localhost/api/cron/billing", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      expiredQuotes: 2,
      overdueInvoices: 3,
    });
  });

  it("gir 404 når begge modulene er av", async () => {
    mocks.moduleEnabled.mockResolvedValue(false);
    const response = await GET(
      new Request("http://localhost/api/cron/billing", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    expect(response.status).toBe(404);
    expect(mocks.expireQuotes).not.toHaveBeenCalled();
    expect(mocks.markOverdueInvoices).not.toHaveBeenCalled();
  });
});
