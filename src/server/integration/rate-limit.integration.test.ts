import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("RateLimit: atomisk teller", () => {
  const key = unique("IT-rate");

  afterAll(async () => {
    await prisma.rateLimit.deleteMany({ where: { key } });
  });

  it("slipper gjennom til grensen og avviser deretter", async () => {
    expect((await allowRequestDb(key, 2, 60_000)).allowed).toBe(true);
    expect((await allowRequestDb(key, 2, 60_000)).allowed).toBe(true);

    const denied = await allowRequestDb(key, 2, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });
});
