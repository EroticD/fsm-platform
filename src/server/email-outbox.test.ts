import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const prisma = {
    emailSettings: { findUnique: vi.fn() },
    emailMessage: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    branding: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    customer: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
    audit: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return {
    prisma,
    sendMail: vi.fn(),
    isSmtpConfigured: vi.fn(),
    safeEmailError: vi.fn(),
    moduleEnabled: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/email", () => ({
  isSmtpConfigured: mocks.isSmtpConfigured,
  createSmtpTransport: () => ({ sendMail: mocks.sendMail }),
  safeEmailError: mocks.safeEmailError,
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.prisma.audit.create }));
vi.mock("./modules", () => ({ moduleEnabled: mocks.moduleEnabled }));

import {
  EMAIL_MAX_ATTEMPTS,
  claimNextEmailMessage,
  emailBackoffMs,
  enqueueEmail,
  processEmailMessage,
  processEmailOutbox,
  type EmailMessageRow,
} from "./email-outbox";

const settingsRow = {
  id: "default",
  fromName: null,
  fromAddress: null,
  replyTo: null,
  quoteSent: true,
  invoiceSent: true,
  paymentReceived: true,
  bookingRequested: true,
  bookingConfirmed: true,
  bookingCancelled: true,
  workOrderAssigned: true,
  updatedAt: new Date(),
  updatedById: null,
};

function row(overrides: Partial<EmailMessageRow> = {}): EmailMessageRow {
  return {
    id: "em-1",
    to: "kunde@example.test",
    subject: "Faktura",
    template: "invoiceSent",
    payload: { reference: "F-1", link: "/kundeportal" },
    locale: "nb",
    status: "SENDING",
    attempts: 1,
    nextAttemptAt: new Date(),
    lastError: null,
    idempotencyKey: "invoice-sent:inv-1",
    lockedAt: new Date(),
    createdAt: new Date(),
    sentAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSmtpConfigured.mockReturnValue(true);
  mocks.moduleEnabled.mockResolvedValue(true);
  mocks.safeEmailError.mockReturnValue("ECONNECTION");
  mocks.prisma.branding.findFirst.mockResolvedValue(null);
  mocks.prisma.emailSettings.findUnique.mockResolvedValue(null);
  mocks.prisma.emailMessage.update.mockResolvedValue({ attempts: 1 });
  mocks.prisma.emailMessage.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.emailMessage.findUnique.mockResolvedValue(null);
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.sendMail.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enqueueEmail", () => {
  it("er idempotent på idempotencyKey", async () => {
    mocks.prisma.emailMessage.create.mockResolvedValueOnce({ id: "em-1" });
    mocks.prisma.emailMessage.create.mockRejectedValueOnce({ code: "P2002" });
    mocks.prisma.emailMessage.findUnique.mockResolvedValue({ id: "em-1" });

    const input = {
      to: "Kunde@Example.test",
      template: "invoiceSent" as const,
      event: "invoiceSent" as const,
      idempotencyKey: "invoice-sent:inv-1",
      payload: { reference: "F-1" },
    };

    const first = await enqueueEmail(input);
    const second = await enqueueEmail(input);

    expect(first).toEqual({ queued: true, id: "em-1", reason: "queued" });
    expect(second).toEqual({ queued: false, id: "em-1", reason: "duplicate" });
    expect(mocks.prisma.emailMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          to: "kunde@example.test",
          template: "invoiceSent",
          idempotencyKey: "invoice-sent:inv-1",
        }),
      }),
    );
  });

  it("hopper over en hendelse administratoren har slått av", async () => {
    mocks.prisma.emailSettings.findUnique.mockResolvedValue({
      ...settingsRow,
      invoiceSent: false,
    });

    const result = await enqueueEmail({
      to: "kunde@example.test",
      template: "invoiceSent",
      event: "invoiceSent",
      idempotencyKey: "invoice-sent:inv-1",
      payload: {},
    });

    expect(result.reason).toBe("disabled");
    expect(mocks.prisma.emailMessage.create).not.toHaveBeenCalled();
  });

  it("lagrer ikke en melding uten gyldig mottaker", async () => {
    const result = await enqueueEmail({
      to: "ikke-en-adresse",
      template: "invoiceSent",
      event: "invoiceSent",
      idempotencyKey: "invoice-sent:inv-1",
      payload: {},
    });

    expect(result.reason).toBe("invalid_recipient");
    expect(mocks.prisma.emailMessage.create).not.toHaveBeenCalled();
  });
});

describe("processEmailMessage", () => {
  it("retryer med eksponentiell backoff og lagrer bare feilkoden", async () => {
    mocks.sendMail.mockRejectedValue(
      new Error("550 mottaker kunde@example.test avvist"),
    );
    mocks.prisma.emailMessage.update
      .mockResolvedValueOnce({ attempts: 2 })
      .mockResolvedValueOnce({ id: "em-1" });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const before = Date.now();
    const outcome = await processEmailMessage(row());

    expect(outcome).toBe("retry");
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.emailMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { attempts: { increment: 1 } },
      }),
    );
    const update = mocks.prisma.emailMessage.update.mock.calls[1][0] as {
      data: { status: string; nextAttemptAt: Date; lastError: string };
    };
    expect(update.data.status).toBe("PENDING");
    expect(update.data.lastError).toBe("ECONNECTION");
    expect(update.data.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + emailBackoffMs(2) - 1_000,
    );

    const logs = warn.mock.calls.flat().join(" ");
    expect(logs).not.toContain("kunde@example.test");
    expect(logs).not.toContain("550 mottaker");
  });

  it("gir opp etter maks antall forsøk", async () => {
    mocks.sendMail.mockRejectedValue(new Error("SMTP nede"));
    mocks.prisma.emailMessage.update
      .mockResolvedValueOnce({ attempts: EMAIL_MAX_ATTEMPTS })
      .mockResolvedValueOnce({ id: "em-1" });

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outcome = await processEmailMessage(row());

    expect(outcome).toBe("failed");
    expect(mocks.prisma.emailMessage.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", lastError: "ECONNECTION" }),
      }),
    );
    expect(error.mock.calls.flat().join(" ")).not.toContain("kunde@example.test");
  });

  it("markerer meldingen SENT og tømmer payload", async () => {
    const outcome = await processEmailMessage(row());

    expect(outcome).toBe("sent");
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "kunde@example.test",
        subject: expect.stringContaining("Faktura"),
      }),
    );
    expect(mocks.prisma.emailMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT", payload: {} }),
      }),
    );
  });

  it("er en trygg no-op uten SMTP", async () => {
    mocks.isSmtpConfigured.mockReturnValue(false);

    const outcome = await processEmailMessage(row());

    expect(outcome).toBe("smtp_off");
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(mocks.prisma.emailMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING" }),
      }),
    );
  });
});

describe("processEmailOutbox", () => {
  it("claimer én gang og sender meldingen når SMTP er på", async () => {
    mocks.prisma.$queryRaw
      // Første kall er requeue av utløpte SENDING-rader.
      .mockResolvedValueOnce([])
      // Deretter claim av én melding, og til slutt en tom kø.
      .mockResolvedValueOnce([row()])
      .mockResolvedValue([]);

    const result = await processEmailOutbox();

    expect(result).toMatchObject({
      skipped: false,
      claimed: 1,
      sent: 1,
      retried: 0,
      failed: 0,
    });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    // requeue + claim + tom claim
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it("gjør ingenting når SMTP mangler", async () => {
    mocks.isSmtpConfigured.mockReturnValue(false);

    const result = await processEmailOutbox();

    expect(result.skipped).toBe(true);
    expect(result.claimed).toBe(0);
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("claim-queryen bruker FOR UPDATE SKIP LOCKED", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([]);
    await claimNextEmailMessage();

    const query = String(
      (mocks.prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join("?"),
    );
    expect(query).toContain("FOR UPDATE SKIP LOCKED");
    expect(query).toContain('"status" = \'SENDING\'');
  });
});
