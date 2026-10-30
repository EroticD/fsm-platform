import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    review: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
    },
    visit: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  allowRequestDb: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));

import {
  getPublicReview,
  hashReviewToken,
  requestReview,
  reviewSummaryForScope,
  REVIEW_TOKEN_PATTERN,
  submitReview,
} from "./reviews";

const TOKEN = "b".repeat(64);
const TOKEN_HASH = hashReviewToken(TOKEN);

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "office-1",
    name: "Ola Kontor",
    email: "ola@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-1",
    permissionsCustomized: true,
    permissions: ["workorders.edit"],
    roleDefinition: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (client: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.visit.findFirst.mockResolvedValue({
    id: "visit-1",
    workOrderId: "wo-1",
    status: "DONE",
    workOrder: { title: "Årlig service" },
  });
  mocks.prisma.review.upsert.mockImplementation(
    async ({ create }: { create: { tokenHash: string } }) => ({
      id: "review-1",
      tokenHash: create.tokenHash,
      submittedAt: null,
    }),
  );
  mocks.prisma.review.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.review.findUnique.mockResolvedValue({
    score: 5,
    submittedAt: new Date("2026-10-30T12:00:00.000Z"),
    requestedAt: new Date("2026-10-30T10:00:00.000Z"),
  });
  mocks.allowRequestDb.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  mocks.audit.mockResolvedValue(undefined);
});

describe("be om omtale", () => {
  it("oppretter én rad etter DONE og returnerer tokenet bare én gang", async () => {
    const result = await requestReview(actor(), "visit-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.token).toMatch(REVIEW_TOKEN_PATTERN);
    expect(result.data.created).toBe(true);
    expect(result.data.submitted).toBe(false);

    const call = mocks.prisma.review.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ visitId: "visit-1" });
    expect(call.create).toMatchObject({
      workOrderId: "wo-1",
      visitId: "visit-1",
      tokenHash: hashReviewToken(result.data.token!),
    });
    expect(JSON.stringify(call)).not.toContain(result.data.token);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it("er idempotent: en eksisterende rad gir ingen nytt token", async () => {
    mocks.prisma.review.upsert.mockResolvedValue({
      id: "review-existing",
      tokenHash: "c".repeat(64),
      submittedAt: null,
    });

    const result = await requestReview(actor(), "visit-1");

    expect(result).toEqual({
      ok: true,
      data: {
        reviewId: "review-existing",
        token: null,
        created: false,
        submitted: false,
      },
    });
    expect(mocks.prisma.review.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("avviser visitt som ikke er DONE", async () => {
    mocks.prisma.visit.findFirst.mockResolvedValue({
      id: "visit-1",
      workOrderId: "wo-1",
      status: "ON_SITE",
      workOrder: { title: "Årlig service" },
    });

    const result = await requestReview(actor(), "visit-1");

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "reviews.errors.notDone" },
    });
    expect(mocks.prisma.review.upsert).not.toHaveBeenCalled();
  });
});

describe("offentlig omtale", () => {
  it("leser bare status og poengsum", async () => {
    const result = await getPublicReview(TOKEN);

    expect(result).toEqual({
      ok: true,
      data: {
        submitted: true,
        score: 5,
        submittedAt: new Date("2026-10-30T12:00:00.000Z"),
      },
    });
    expect(mocks.prisma.review.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: TOKEN_HASH } }),
    );
  });

  it("avviser ukjent token og ugyldig format", async () => {
    mocks.prisma.review.findUnique.mockResolvedValueOnce(null);
    await expect(getPublicReview(TOKEN)).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });

    await expect(getPublicReview("xyz")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(mocks.prisma.review.findUnique).toHaveBeenCalledTimes(1);
  });

  it("sender inn nøyaktig én gang", async () => {
    const first = await submitReview(TOKEN, {
      score: 4,
      comment: "  Rask og hyggelig.  ",
    });

    expect(first.ok).toBe(true);
    expect(mocks.prisma.review.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: TOKEN_HASH,
        requestedAt: { not: null },
        submittedAt: null,
      },
      data: {
        score: 4,
        comment: "Rask og hyggelig.",
        submittedAt: expect.any(Date),
      },
    });

    mocks.prisma.review.updateMany.mockResolvedValue({ count: 0 });
    const second = await submitReview(TOKEN, { score: 2 });

    expect(second).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "reviews.errors.alreadySubmitted" },
    });
  });

  it("avviser poengsum utenfor 1–5", async () => {
    for (const score of [0, 6, 2.5]) {
      await expect(submitReview(TOKEN, { score })).resolves.toMatchObject({
        ok: false,
        reason: "invalid",
        details: { code: "reviews.errors.invalidScore" },
      });
    }
    expect(mocks.prisma.review.updateMany).not.toHaveBeenCalled();
  });

  it("avviser ukjent token etter at oppdateringen ikke traff", async () => {
    mocks.prisma.review.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.review.findUnique.mockResolvedValue(null);

    await expect(submitReview(TOKEN, { score: 5 })).resolves.toMatchObject({
      ok: false,
      reason: "not_found",
      details: { code: "reviews.errors.invalidToken" },
    });
  });
});

describe("omtaleaggregat", () => {
  it("runder gjennomsnittet og teller bare innsendte omtaler", async () => {
    mocks.prisma.review.aggregate.mockResolvedValue({
      _avg: { score: 4.26 },
      _count: { _all: 12 },
    });

    const summary = await reviewSummaryForScope({ departmentId: "dep-1" });

    expect(summary).toEqual({ average: 4.3, count: 12 });
    expect(mocks.prisma.review.aggregate).toHaveBeenCalledWith({
      where: {
        submittedAt: { not: null },
        score: { not: null },
        workOrder: { departmentId: "dep-1" },
      },
      _avg: { score: true },
      _count: { _all: true },
    });
  });

  it("gir null gjennomsnitt når ingen har svart", async () => {
    mocks.prisma.review.aggregate.mockResolvedValue({
      _avg: { score: null },
      _count: { _all: 0 },
    });

    await expect(reviewSummaryForScope({})).resolves.toEqual({
      average: null,
      count: 0,
    });
  });
});
