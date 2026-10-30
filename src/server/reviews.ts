// i18n-ignore-file: revisjonsloggen lagrer faste norske handlingsstrenger på
// samme måte som de øvrige tjenestene; de oversettes ved visning.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { LIMITS, cleanText } from "@/lib/sanitize";
import {
  can,
  fail,
  ok,
  toAuditActor,
  workOrderScopeFor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/** Omtaletokens er 32 tilfeldige byte, hex-kodet. */
export const REVIEW_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** Global, prosesslokal sikring mot flom av tilfeldige velformede tokens. */
const globalReviewWindow = { startedAt: 0, count: 0 };
function allowGlobalReview(now = Date.now()): boolean {
  if (now - globalReviewWindow.startedAt >= 60_000) {
    globalReviewWindow.startedAt = now;
    globalReviewWindow.count = 0;
  }
  globalReviewWindow.count += 1;
  return globalReviewWindow.count <= 1200;
}

export function hashReviewToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newReviewToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function cleanId(value: unknown): string {
  return cleanText(value, { maxLength: LIMITS.line });
}

export type RequestReviewResult = {
  reviewId: string;
  /** Bare satt når raden ble opprettet i dette kallet. */
  token: string | null;
  created: boolean;
  submitted: boolean;
};

/**
 * Ber om en kundeomtale etter at visitten er DONE.
 *
 * `Review.visitId` er unik, og oppslaget gjøres med `upsert` i samme
 * transaksjon. Gjentatte kall – også samtidige – gir derfor nøyaktig én rad.
 * Det rå tokenet returneres bare til den som opprettet raden; senere kall
 * returnerer `token: null`, fordi bare hashen finnes i databasen.
 */
export async function requestReview(
  actor: ServiceActor,
  visitId: string,
): Promise<ServiceResult<RequestReviewResult>> {
  if (!actor?.isActive || !can(actor, "workorders.edit")) {
    return fail("forbidden");
  }

  const id = cleanId(visitId);
  if (!id) return fail("invalid", { code: "reviews.errors.invalidInput" });

  return prisma.$transaction(async (tx) => {
    const visit = await tx.visit.findFirst({
      where: {
        id,
        workOrder: { AND: [workOrderScopeFor(actor)] },
      },
      select: {
        id: true,
        workOrderId: true,
        status: true,
        workOrder: { select: { title: true } },
      },
    });
    if (!visit) return fail("not_found");
    if (visit.status !== "DONE") {
      return fail("conflict", { code: "reviews.errors.notDone" });
    }

    const token = newReviewToken();
    const tokenHash = hashReviewToken(token);
    const requestedAt = new Date();

    const review = await tx.review.upsert({
      where: { visitId: id },
      update: {},
      create: {
        workOrderId: visit.workOrderId,
        visitId: id,
        tokenHash,
        requestedAt,
      },
      select: {
        id: true,
        tokenHash: true,
        submittedAt: true,
      },
    });

    const created = review.tokenHash === tokenHash;
    if (created) {
      await audit(tx, {
        entityType: "Review",
        entityId: review.id,
        action: `Ba om kundeomtale for ${visit.workOrder.title}`,
        actor: toAuditActor(actor),
        metadata: {
          workOrderId: visit.workOrderId,
          visitId: id,
        },
      });
    }

    return ok({
      reviewId: review.id,
      token: created ? token : null,
      created,
      submitted: Boolean(review.submittedAt),
    });
  });
}

export type PublicReviewView = {
  submitted: boolean;
  score: number | null;
  submittedAt: Date | null;
};

export type PublicReviewResult =
  | { ok: true; data: PublicReviewView }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

/**
 * Leser omtalesiden fra et token. Vi returnerer verken kundenavn, adresse
 * eller oppdragstittel – bare om skjemaet er sendt inn og eventuell poengsum.
 */
export async function getPublicReview(
  token: string,
): Promise<PublicReviewResult> {
  if (!REVIEW_TOKEN_PATTERN.test(token)) return { ok: false, reason: "invalid" };
  if (!allowGlobalReview()) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: 60 };
  }

  const tokenHash = hashReviewToken(token);
  const review = await prisma.review.findUnique({
    where: { tokenHash },
    select: {
      score: true,
      submittedAt: true,
      requestedAt: true,
    },
  });
  if (!review?.requestedAt) return { ok: false, reason: "invalid" };

  const limit = await allowRequestDb(`review-page:${tokenHash}`, 120, 60_000);
  if (!limit.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: limit.retryAfterSeconds,
    };
  }

  return {
    ok: true,
    data: {
      submitted: Boolean(review.submittedAt),
      score: review.score,
      submittedAt: review.submittedAt,
    },
  };
}

export type SubmitReviewInput = {
  score: number;
  comment?: string | null;
};

export type SubmitReviewResult = {
  submittedAt: Date;
};

/**
 * Sender inn omtalen nøyaktig én gang.
 *
 * `updateMany` med `submittedAt: null` er den atomiske sperren. To samtidige
 * innsendinger kan derfor ikke begge lykkes; den andre får `conflict` og kan
 * vise «allerede sendt inn».
 */
export async function submitReview(
  token: string,
  input: SubmitReviewInput,
): Promise<ServiceResult<SubmitReviewResult>> {
  if (!REVIEW_TOKEN_PATTERN.test(token)) {
    return fail("not_found", { code: "reviews.errors.invalidToken" });
  }

  const score = input?.score;
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return fail("invalid", { code: "reviews.errors.invalidScore" });
  }

  const comment =
    cleanText(input.comment, { maxLength: LIMITS.text, multiline: true }) ||
    null;

  const tokenHash = hashReviewToken(token);
  const limit = await allowRequestDb(`review-submit:${tokenHash}`, 10, 10 * 60_000);
  if (!limit.allowed) {
    return fail("rate_limited", {
      code: "reviews.errors.rateLimited",
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  const submittedAt = new Date();
  const result = await prisma.review.updateMany({
    where: {
      tokenHash,
      requestedAt: { not: null },
      submittedAt: null,
    },
    data: { score, comment, submittedAt },
  });

  if (result.count === 1) return ok({ submittedAt });

  const existing = await prisma.review.findUnique({
    where: { tokenHash },
    select: { submittedAt: true, requestedAt: true },
  });
  if (existing?.submittedAt) {
    return fail("conflict", { code: "reviews.errors.alreadySubmitted" });
  }
  return fail("not_found", { code: "reviews.errors.invalidToken" });
}

export type ReviewSummary = {
  average: number | null;
  count: number;
};

/**
 * Aggregat for dashbordet. Summene gjøres i databasen og er alltid avgrenset
 * av oppdragenes synlighetsomfang; ingen omtaler lastes inn i minnet.
 */
export async function reviewSummaryForScope(
  scope: Prisma.WorkOrderWhereInput,
): Promise<ReviewSummary> {
  const aggregate = await prisma.review.aggregate({
    where: {
      submittedAt: { not: null },
      score: { not: null },
      workOrder: scope,
    },
    _avg: { score: true },
    _count: { _all: true },
  });

  const average = aggregate._avg.score;
  return {
    average:
      average === null || average === undefined
        ? null
        : Math.round(average * 10) / 10,
    count: aggregate._count._all,
  };
}
