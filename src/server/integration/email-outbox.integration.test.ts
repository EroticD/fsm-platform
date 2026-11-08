import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  isSmtpConfigured: vi.fn(() => true),
  safeEmailError: vi.fn((error: unknown) => {
    if (error && typeof error === "object" && "code" in error) {
      return String((error as { code?: unknown }).code);
    }
    return "ukjent feil";
  }),
}));

vi.mock("@/lib/email", () => ({
  isSmtpConfigured: mocks.isSmtpConfigured,
  createSmtpTransport: () => ({ sendMail: mocks.sendMail }),
  safeEmailError: mocks.safeEmailError,
}));
vi.mock("@/server/modules", () => ({
  moduleEnabled: vi.fn().mockResolvedValue(true),
}));

import {
  claimNextEmailMessage,
  enqueueEmail,
  processEmailOutbox,
} from "@/server/email-outbox";

const describeIntegration = integrationEnabled ? describe : describe.skip;

let prefix = "";

function key(name: string) {
  return `${prefix}:${name}`;
}

beforeAll(async () => {
  prefix = unique("email-outbox-it");
  await prisma.emailSettings.deleteMany({ where: { id: "default" } });
  await prisma.emailMessage.deleteMany({
    where: { idempotencyKey: { startsWith: prefix } },
  });
});

afterAll(async () => {
  await prisma.emailMessage.deleteMany({
    where: { idempotencyKey: { startsWith: prefix } },
  });
  await prisma.emailSettings.deleteMany({ where: { id: "default" } });
});

beforeEach(async () => {
  // Hver test skal se en tom kø med bare sine egne rader. Andre
  // integrasjonstester kan ha lagt igjen meldinger; de skyves ut av veien slik
  // at claim-testene våre ikke plukker dem i stedet.
  await prisma.emailMessage.deleteMany({
    where: { idempotencyKey: { startsWith: prefix } },
  });
  await prisma.emailMessage.updateMany({
    where: { status: "PENDING" },
    data: { nextAttemptAt: new Date(Date.now() + 3_600_000) },
  });
  mocks.sendMail.mockReset();
  mocks.sendMail.mockResolvedValue({});
  mocks.isSmtpConfigured.mockReturnValue(true);
});

describeIntegration("EmailMessage utboks mot PostgreSQL", () => {
  it("er idempotent også når samme nøkkel enqueues samtidig", async () => {
    const input = {
      to: "kunde@example.test",
      template: "invoiceSent" as const,
      event: "invoiceSent" as const,
      idempotencyKey: key("concurrent-enqueue"),
      payload: { reference: "F-1" },
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => enqueueEmail(input)),
    );
    const rows = await prisma.emailMessage.findMany({
      where: { idempotencyKey: input.idempotencyKey },
    });

    expect(rows).toHaveLength(1);
    expect(results.filter((result) => result.queued)).toHaveLength(1);
    expect(
      results.filter((result) => result.reason === "duplicate"),
    ).toHaveLength(4);
  });

  it("lar bare én samtidig worker claim samme melding", async () => {
    const queued = await enqueueEmail({
      to: "kunde@example.test",
      template: "invoiceSent",
      event: "invoiceSent",
      idempotencyKey: key("claim-once"),
      payload: { reference: "F-2" },
    });
    expect(queued.id).toBeTruthy();

    const [first, second] = await Promise.all([
      claimNextEmailMessage(),
      claimNextEmailMessage(),
    ]);

    const claimed = [first, second].filter(Boolean);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(queued.id);
    expect(claimed[0]?.status).toBe("SENDING");

    const row = await prisma.emailMessage.findUnique({
      where: { id: queued.id! },
    });
    expect(row?.status).toBe("SENDING");
    expect(row?.attempts).toBe(0);
  });

  it("går fra feil til retry til sent med backoff", async () => {
    const queued = await enqueueEmail({
      to: "kunde@example.test",
      template: "invoiceSent",
      event: "invoiceSent",
      idempotencyKey: key("retry-sent"),
      payload: { reference: "F-3" },
    });
    expect(queued.id).toBeTruthy();

    mocks.sendMail.mockRejectedValueOnce({ code: "ECONNECTION" });
    const firstRun = await processEmailOutbox({ limit: 1 });

    expect(firstRun).toMatchObject({ claimed: 1, retried: 1, sent: 0 });
    const retried = await prisma.emailMessage.findUnique({
      where: { id: queued.id! },
    });
    expect(retried?.status).toBe("PENDING");
    expect(retried?.attempts).toBe(1);
    expect(retried?.lastError).toBe("ECONNECTION");
    expect(retried?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await prisma.emailMessage.update({
      where: { id: queued.id! },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });

    mocks.sendMail.mockResolvedValueOnce({});
    const secondRun = await processEmailOutbox({ limit: 1 });

    expect(secondRun).toMatchObject({ claimed: 1, sent: 1, retried: 0 });
    const sent = await prisma.emailMessage.findUnique({
      where: { id: queued.id! },
    });
    expect(sent?.status).toBe("SENT");
    expect(sent?.attempts).toBe(1);
    expect(sent?.sentAt).not.toBeNull();
    expect(sent?.lastError).toBeNull();
    expect(sent?.payload).toEqual({});
    expect(mocks.sendMail).toHaveBeenCalledTimes(2);
  });

  it("sender aldri samme melding to ganger når to workers kjører samtidig", async () => {
    const queued = await enqueueEmail({
      to: "kunde@example.test",
      template: "invoiceSent",
      event: "invoiceSent",
      idempotencyKey: key("two-workers"),
      payload: { reference: "F-4" },
    });
    expect(queued.id).toBeTruthy();

    const [a, b] = await Promise.all([
      processEmailOutbox({ limit: 1 }),
      processEmailOutbox({ limit: 1 }),
    ]);

    expect(a.claimed + b.claimed).toBe(1);
    expect(a.sent + b.sent).toBe(1);
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
  });
});
