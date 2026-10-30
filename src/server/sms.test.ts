import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    smsSetting: { upsert: vi.fn(), findUnique: vi.fn() },
    channelPreference: { findUnique: vi.fn(), upsert: vi.fn() },
    smsMessage: {
      create: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    smsTemplate: { findMany: vi.fn(), upsert: vi.fn() },
    contact: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    messageThread: { count: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  claimNextSmsMessage,
  enqueueSms,
  getSmsSettings,
  hasSmsConsent,
  processSmsMessage,
  saveSmsSettings,
  saveSmsTemplate,
} from "./sms";

const actor: ServiceActor = {
  id: "u1",
  name: "Kari Kontor",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-1",
  permissions: ["settings.manage", "workorders.update", "customers.manage"],
  permissionsCustomized: true,
  roleDefinition: null,
};

const settings = {
  id: "default",
  defaultLocale: "nb",
  optOutKeywords: ["STOP"],
  optInKeywords: ["START"],
  monthlyCap: 0,
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SMS_ALLOWLIST;
  delete process.env.SMS_PROVIDER;

  mocks.prisma.smsSetting.upsert.mockResolvedValue(settings);
  mocks.prisma.channelPreference.findUnique.mockResolvedValue({
    optedIn: true,
    optedOut: false,
  });
  mocks.prisma.channelPreference.upsert.mockResolvedValue({});
  mocks.prisma.smsMessage.create.mockResolvedValue({ id: "sms-1" });
  mocks.prisma.smsMessage.count.mockResolvedValue(0);
  mocks.prisma.smsMessage.update.mockResolvedValue({});
  mocks.prisma.smsTemplate.upsert.mockResolvedValue({ id: "tpl-1" });
  mocks.prisma.smsTemplate.findMany.mockResolvedValue([]);
  mocks.prisma.contact.findUnique.mockResolvedValue({ id: "c1", name: "Kari" });
  mocks.prisma.user.findUnique.mockResolvedValue({ id: "u1", name: "Kari" });
  mocks.prisma.$queryRaw.mockResolvedValue([]);
  mocks.prisma.$transaction.mockImplementation(
    async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: unknown) => unknown)(mocks.prisma)
        : Promise.all(arg as Promise<unknown>[]),
  );
});

describe("samtykke", () => {
  it("nei uten registrert samtykke", async () => {
    mocks.prisma.channelPreference.findUnique.mockResolvedValue(null);

    expect(await hasSmsConsent({ contactId: "c1" })).toBe(false);
    const result = await enqueueSms({
      to: "+4790000000",
      body: "Hei",
      contactId: "c1",
    });

    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.smsMessage.create).not.toHaveBeenCalled();
  });

  it("nei når kontakten er reservert", async () => {
    mocks.prisma.channelPreference.findUnique.mockResolvedValue({
      optedIn: true,
      optedOut: true,
    });

    const result = await enqueueSms({
      to: "+4790000000",
      body: "Hei",
      contactId: "c1",
    });

    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("legger i kø når samtykket er aktivt", async () => {
    const result = await enqueueSms({
      to: "+4790000000",
      body: "Hei",
      contactId: "c1",
      departmentId: "dep-1",
      templateKey: "VISIT_REMINDER",
      locale: "en",
    });

    expect(result).toEqual({
      ok: true,
      data: { id: "sms-1", provider: "console" },
    });
    expect(mocks.prisma.smsMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "QUEUED",
          provider: "console",
          contactId: "c1",
          templateKey: "VISIT_REMINDER",
          locale: "en",
        }),
      }),
    );
  });

  it("respekterer SMS_ALLOWLIST", async () => {
    process.env.SMS_ALLOWLIST = "4711111111";

    const result = await enqueueSms({
      to: "+4790000000",
      body: "Hei",
      contactId: "c1",
    });

    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.smsMessage.create).not.toHaveBeenCalled();
  });

  it("stopper ved månedlig grense", async () => {
    mocks.prisma.smsSetting.upsert.mockResolvedValue({
      ...settings,
      monthlyCap: 2,
    });
    mocks.prisma.smsMessage.count.mockResolvedValue(2);

    const result = await enqueueSms({
      to: "+4790000000",
      body: "Hei",
      contactId: "c1",
      departmentId: "dep-1",
    });

    expect(result).toMatchObject({ ok: false, reason: "rate_limited" });
  });
});

describe("kø og retry", () => {
  it("markerer vellykket console-sending som SENT", async () => {
    const outcome = await processSmsMessage({
      id: "sms-1",
      direction: "OUTBOUND",
      provider: "console",
      to: "+4790000000",
      body: "Hei",
      status: "SENDING",
      attempts: 1,
      nextAttemptAt: new Date(),
      lockedAt: new Date(),
      lockedBy: "test",
      lastError: null,
      contactId: "c1",
      userId: null,
      workOrderId: null,
      departmentId: null,
      threadId: null,
    });

    expect(outcome).toBe("sent");
    expect(mocks.prisma.smsMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT" }),
      }),
    );
  });

  it("legger tilbake i køen med backoff etter feil", async () => {
    const outcome = await processSmsMessage({
      id: "sms-1",
      direction: "OUTBOUND",
      provider: "linkmobility",
      to: "+4790000000",
      body: "Hei",
      status: "SENDING",
      attempts: 1,
      nextAttemptAt: new Date(),
      lockedAt: new Date(),
      lockedBy: "test",
      lastError: null,
      contactId: "c1",
      userId: null,
      workOrderId: null,
      departmentId: null,
      threadId: null,
    });

    expect(outcome).toBe("retry");
    expect(mocks.prisma.smsMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "QUEUED" }),
      }),
    );
  });

  it("sender ikke en melding når samtykket er trukket etter køing", async () => {
    mocks.prisma.channelPreference.findUnique.mockResolvedValue({
      optedIn: true,
      optedOut: true,
    });

    const outcome = await processSmsMessage({
      id: "sms-1",
      direction: "OUTBOUND",
      provider: "console",
      to: "+4790000000",
      body: "Hei",
      status: "SENDING",
      attempts: 1,
      nextAttemptAt: new Date(),
      lockedAt: new Date(),
      lockedBy: "test",
      lastError: null,
      contactId: "c1",
      userId: null,
      workOrderId: null,
      departmentId: null,
      threadId: null,
    });

    expect(outcome).toBe("dead_letter");
    expect(mocks.prisma.smsMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          lastError: "no-consent",
        }),
      }),
    );
  });

  it("dead-letterer etter tre forsøk", async () => {
    const outcome = await processSmsMessage({
      id: "sms-1",
      direction: "OUTBOUND",
      provider: "linkmobility",
      to: "+4790000000",
      body: "Hei",
      status: "SENDING",
      attempts: 3,
      nextAttemptAt: new Date(),
      lockedAt: new Date(),
      lockedBy: "test",
      lastError: null,
      contactId: "c1",
      userId: null,
      workOrderId: null,
      departmentId: null,
      threadId: null,
    });

    expect(outcome).toBe("dead_letter");
    expect(mocks.prisma.smsMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DEAD_LETTER",
          deadLetteredAt: expect.any(Date),
        }),
      }),
    );
  });

  it("claim bruker én atomisk rad", async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: "sms-1" }]);

    await expect(claimNextSmsMessage("worker-1")).resolves.toEqual({
      id: "sms-1",
    });
    expect(mocks.prisma.$queryRaw).toHaveBeenCalled();
  });
});

describe("maler og innstillinger", () => {
  it("avviser mal med ukjent plassholder", async () => {
    const result = await saveSmsTemplate(actor, {
      eventKey: "VISIT_REMINDER",
      locale: "nb",
      body: "Hei {hemmelighet}",
      isActive: true,
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(mocks.prisma.smsTemplate.upsert).not.toHaveBeenCalled();
  });

  it("lagrer mal med hvitelistede variabler", async () => {
    const result = await saveSmsTemplate(actor, {
      eventKey: "VISIT_REMINDER",
      locale: "nb",
      body: "Hei {contactName}! {workOrderTitle}",
      isActive: true,
    });

    expect(result).toEqual({ ok: true, data: { id: "tpl-1" } });
    expect(mocks.prisma.smsTemplate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          variables: ["contactName", "workOrderTitle"],
        }),
      }),
    );
  });

  it("normaliserer reservasjonsord og månedlig grense", async () => {
    const result = await saveSmsSettings(actor, {
      defaultLocale: "en",
      optOutKeywords: "stopp, meld av\nSTOPP",
      optInKeywords: "start; ja",
      monthlyCap: "500",
    });

    expect(result.ok).toBe(true);
    expect(mocks.prisma.smsSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          defaultLocale: "en",
          optOutKeywords: ["STOPP", "MELD AV"],
          optInKeywords: ["START", "JA"],
          monthlyCap: 500,
        }),
      }),
    );
  });

  it("oppretter standardinnstillingene ved behov", async () => {
    await getSmsSettings();
    expect(mocks.prisma.smsSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "default" } }),
    );
  });
});
