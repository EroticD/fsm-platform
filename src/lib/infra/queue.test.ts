import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PDF_TEXT_QUEUE_KEY,
  forgetPdfJob,
  notifyPdfJob,
  pdfQueueBackend,
  pdfQueueSize,
  takeDuePdfJobIds,
} from "./queue";
import {
  queueDriver,
  resetRedisForTests,
  setRedisClientForTests,
} from "./redis";

type FakeRedis = {
  store: Map<string, number>;
  zadd: ReturnType<typeof vi.fn>;
  zrangebyscore: ReturnType<typeof vi.fn>;
  zrem: ReturnType<typeof vi.fn>;
  zcard: ReturnType<typeof vi.fn>;
};

function fakeRedis(): FakeRedis {
  const store = new Map<string, number>();
  return {
    store,
    zadd: vi.fn(async (_key: string, score: number, member: string) => {
      store.set(member, score);
      return 1;
    }),
    zrangebyscore: vi.fn(
      async (_key: string, _min: string, max: number) =>
        [...store.entries()]
          .filter(([, score]) => score <= max)
          .sort((a, b) => a[1] - b[1])
          .map(([member]) => member),
    ),
    zrem: vi.fn(async (_key: string, ...members: string[]) => {
      for (const member of members) store.delete(member);
      return members.length;
    }),
    zcard: vi.fn(async () => store.size),
  };
}

function install(client: FakeRedis | null) {
  setRedisClientForTests(client as unknown as Redis | null);
}

beforeEach(() => {
  resetRedisForTests();
});
afterEach(() => {
  resetRedisForTests();
});

describe("Redis-kø for PDF-jobber", () => {
  it("er en no-op uten Redis (DB-driver er standard)", async () => {
    expect(pdfQueueBackend({})).toBe("db");
    expect(queueDriver({})).toBe("db");
    expect(queueDriver({ QUEUE_DRIVER: "" })).toBe("db");
    await expect(notifyPdfJob("jobb-1")).resolves.toBe(false);
    await expect(takeDuePdfJobIds()).resolves.toEqual([]);
  });

  it("legger jobber i sortert liste og henter bare klare jobber", async () => {
    const redis = fakeRedis();
    install(redis);
    const now = new Date("2026-11-09T10:00:00.000Z");

    await notifyPdfJob("senere", new Date(now.getTime() + 60_000));
    await notifyPdfJob("klar", now);

    await expect(takeDuePdfJobIds(now)).resolves.toEqual(["klar"]);
    expect(redis.zadd).toHaveBeenCalledWith(
      PDF_TEXT_QUEUE_KEY,
      now.getTime(),
      "klar",
    );
    expect(redis.store.has("klar")).toBe(false);
    expect(redis.store.has("senere")).toBe(true);
  });

  it("er idempotent: samme jobb-ID gir ett medlem", async () => {
    const redis = fakeRedis();
    install(redis);
    await notifyPdfJob("samme", new Date(1));
    await notifyPdfJob("samme", new Date(2));
    expect(redis.store.size).toBe(1);
    expect(await pdfQueueSize()).toBe(1);
  });

  it("fjerner jobb etter DONE/FAILED", async () => {
    const redis = fakeRedis();
    install(redis);
    await notifyPdfJob("ferdig");
    await forgetPdfJob("ferdig");
    expect(redis.store.size).toBe(0);
  });

  it("faller tilbake til tom liste når Redis feiler", async () => {
    const redis = fakeRedis();
    redis.zrangebyscore.mockRejectedValue(new Error("redis nede"));
    install(redis);

    await expect(takeDuePdfJobIds()).resolves.toEqual([]);
  });
});
