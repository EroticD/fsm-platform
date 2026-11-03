import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("") : "";
      if (sql.includes("pg_roles")) {
        return [
          {
            currentUser: "fsm_app",
            superuser: false,
            createDb: false,
            createRole: false,
            schemaCreate: false,
          },
        ];
      }
      return [];
    }),
    documentJob: { count: vi.fn(async () => 0) },
  },
}));
vi.mock("node:fs/promises", () => ({
  default: { mkdir: vi.fn(async () => undefined), access: vi.fn(async () => undefined) },
}));
vi.mock("@/lib/uploads", () => ({ uploadDir: () => "/tmp/uploads" }));

import { GET } from "./route";
import fs from "node:fs/promises";
import prisma from "@/lib/prisma";

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

  it("gjør ikke disk- eller køarbeid for uautentiserte kall", async () => {
    const access = vi.mocked(fs.access);
    const count = vi.mocked(prisma.documentJob.count);
    access.mockClear();
    count.mockClear();

    await GET(new Request("http://localhost:3000/api/ready"));

    expect(access).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
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

  it("returnerer 503 når runtime-rollen kan endre skjema i produksjon", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DB_DDL_ROLE", "");
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          currentUser: "admin",
          superuser: true,
          createDb: true,
          createRole: true,
          schemaCreate: true,
        },
      ]);

    try {
      const response = await GET(
        new Request("http://localhost:3000/api/ready", {
          headers: { authorization: "Bearer ready-secret" },
        }),
      );
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.status).toBe("not_ready");
      expect(body.databaseRole).toMatchObject({
        currentUser: "admin",
        canDdl: true,
      });
      expect(body.queue).toEqual({ pending: 0, failed: 0 });
    } finally {
      vi.unstubAllEnvs();
      vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    }
  });
});
