import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    smsMessage: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    messageThread: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    message: { create: vi.fn(), updateMany: vi.fn() },
    contact: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    customer: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  applyInboundConsent: vi.fn(),
  getSmsSettings: vi.fn(),
  enqueueSms: vi.fn(),
  hasSmsConsent: vi.fn(),
  notifyUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("./notifications", () => ({ notifyUser: mocks.notifyUser }));
vi.mock("./sms", () => ({
  applyInboundConsent: mocks.applyInboundConsent,
  enqueueSms: mocks.enqueueSms,
  getSmsSettings: mocks.getSmsSettings,
  hasSmsConsent: mocks.hasSmsConsent,
}));

import {
  getMessageThread,
  messageThreadScopeFor,
  recordInboundSms,
  sendThreadMessage,
} from "./messaging";

const officeActor: ServiceActor = {
  id: "office-1",
  name: "Kontor",
  email: "kontor@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-1",
  permissions: ["workorders.view", "workorders.update"],
  permissionsCustomized: true,
  roleDefinition: null,
};

const contact = {
  id: "contact-1",
  name: "Kari",
  phone: "+47 900 00 000",
  locale: "nb",
  customerId: "customer-1",
  customer: { name: "Kunde AS", departmentId: "dep-1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSmsSettings.mockResolvedValue({
    optOutKeywords: ["STOP"],
    optInKeywords: ["START"],
  });
  mocks.hasSmsConsent.mockResolvedValue(false);
  mocks.prisma.smsMessage.findUnique.mockResolvedValue(null);
  mocks.prisma.smsMessage.create.mockResolvedValue({ id: "sms-1" });
  mocks.prisma.smsMessage.update.mockResolvedValue({});
  mocks.prisma.smsMessage.findMany.mockResolvedValue([]);
  mocks.prisma.contact.findMany.mockResolvedValue([contact]);
  mocks.prisma.user.findMany.mockResolvedValue([]);
  mocks.prisma.customer.findMany.mockResolvedValue([]);
  mocks.prisma.messageThread.findFirst.mockResolvedValue(null);
  mocks.prisma.messageThread.findUnique.mockResolvedValue(null);
  mocks.prisma.messageThread.upsert.mockResolvedValue({ id: "thread-1" });
  mocks.prisma.messageThread.update.mockResolvedValue({ id: "thread-1" });
  mocks.prisma.message.create.mockResolvedValue({ id: "message-1" });
  mocks.prisma.$transaction.mockImplementation(
    async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: unknown) => unknown)(mocks.prisma)
        : Promise.all(arg as Promise<unknown>[]),
  );
});

describe("innkommende SMS-mapping", () => {
  it("normaliserer telefonnummer og kobler kunde/kontakt/tråd", async () => {
    const result = await recordInboundSms({
      provider: "console",
      providerId: "delivery-1",
      from: "90000000",
      to: "4700000000",
      body: "Hei",
    });

    expect(result).toMatchObject({
      duplicate: false,
      threadId: "thread-1",
      contactId: "contact-1",
      customerId: "customer-1",
      consentAction: null,
    });
    expect(mocks.prisma.smsMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          direction: "INBOUND",
          status: "RECEIVED",
          contactId: "contact-1",
          departmentId: "dep-1",
        }),
      }),
    );
    expect(mocks.prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: "thread-1",
          direction: "INBOUND",
          fromAddress: "90000000",
        }),
      }),
    );
  });

  it("gjenbruker nyeste tråd for samme kontakt", async () => {
    mocks.prisma.messageThread.findFirst.mockResolvedValue({
      id: "existing-thread",
      departmentId: "dep-1",
    });
    mocks.prisma.messageThread.update.mockResolvedValue({
      id: "existing-thread",
    });

    const result = await recordInboundSms({
      provider: "console",
      providerId: "delivery-2",
      from: "+4790000000",
      to: "4700000000",
      body: "Svar på oppdraget",
    });

    expect(result.threadId).toBe("existing-thread");
    expect(mocks.prisma.messageThread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-thread" },
        data: expect.objectContaining({ unreadCount: { increment: 1 } }),
      }),
    );
  });

  it("er idempotent på leverandørens meldings-ID", async () => {
    mocks.prisma.smsMessage.findUnique.mockResolvedValue({
      id: "sms-1",
      threadId: "thread-1",
      contactId: "contact-1",
    });
    mocks.prisma.messageThread.findUnique.mockResolvedValue({
      customerId: "customer-1",
    });

    const result = await recordInboundSms({
      provider: "console",
      providerId: "delivery-1",
      from: "+4790000000",
      to: "4700000000",
      body: "Hei",
    });

    expect(result).toMatchObject({
      duplicate: true,
      threadId: "thread-1",
      customerId: "customer-1",
    });
    expect(mocks.prisma.smsMessage.create).not.toHaveBeenCalled();
    expect(mocks.prisma.message.create).not.toHaveBeenCalled();
  });

  it("tolker STOP og reserverer kontakten", async () => {
    const result = await recordInboundSms({
      provider: "console",
      providerId: "stop-1",
      from: "+4790000000",
      to: "4700000000",
      body: " stop. ",
    });

    expect(result.consentAction).toBe("OPT_OUT");
    expect(mocks.applyInboundConsent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        contactId: "contact-1",
        action: "OPT_OUT",
      }),
    );
  });

  it("tolker START og registrerer samtykke på nytt", async () => {
    const result = await recordInboundSms({
      provider: "console",
      providerId: "start-1",
      from: "+4790000000",
      to: "4700000000",
      body: "START",
    });

    expect(result.consentAction).toBe("OPT_IN");
    expect(mocks.applyInboundConsent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "OPT_IN" }),
    );
  });

  it("lager ingen tråd for ukjent avsender", async () => {
    mocks.prisma.contact.findMany.mockResolvedValue([]);

    const result = await recordInboundSms({
      provider: "console",
      providerId: "unknown-1",
      from: "+4791111111",
      to: "4700000000",
      body: "Hei",
    });

    expect(result.threadId).toBeNull();
    expect(result.customerId).toBeNull();
    expect(mocks.prisma.messageThread.upsert).not.toHaveBeenCalled();
  });
});

describe("tilgang til meldingstråder", () => {
  it("begrenser kontoransatte til egen avdeling", () => {
    expect(messageThreadScopeFor(officeActor)).toMatchObject({
      departmentId: "dep-1",
    });
  });

  it("gir administratorer alle tråder", () => {
    expect(
      messageThreadScopeFor({ ...officeActor, role: "ADMIN" }),
    ).toEqual({});
  });

  it("begrenser kundeportalen til egen kunde", () => {
    const customer: ServiceActor = {
      ...officeActor,
      role: "CUSTOMER",
      customerId: "customer-1",
      permissions: [],
    };
    expect(messageThreadScopeFor(customer)).toEqual({
      customerId: "customer-1",
    });
  });

  it("avviser brukere uten oppdragsrettigheter", () => {
    expect(
      messageThreadScopeFor({ ...officeActor, permissions: [] }),
    ).toEqual({ id: { in: [] } });
  });

  it("avviser svar fra en bruker uten skrivetilgang", async () => {
    const result = await sendThreadMessage(
      { ...officeActor, permissions: [] },
      "thread-1",
      "Hei",
    );
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.messageThread.findFirst).not.toHaveBeenCalled();
  });

  it("avviser kunde fra en annen kundes tråd", async () => {
    const customer: ServiceActor = {
      ...officeActor,
      role: "CUSTOMER",
      customerId: "customer-2",
      permissions: [],
    };
    mocks.prisma.messageThread.findFirst.mockResolvedValue(null);

    const result = await sendThreadMessage(customer, "thread-1", "Hei");
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(mocks.prisma.messageThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [expect.objectContaining({ customerId: "customer-2" })],
        }),
      }),
    );
  });

  it("lar ikke kundeportalen nullstille kontorets ulest-teller", async () => {
    const customer: ServiceActor = {
      ...officeActor,
      role: "CUSTOMER",
      customerId: "customer-1",
      permissions: [],
    };
    mocks.prisma.messageThread.findFirst.mockResolvedValue({
      id: "thread-1",
      customerId: "customer-1",
      contactId: "contact-1",
      unreadCount: 3,
      customer: { id: "customer-1", name: "Kunde AS", phone: null, email: null },
      contact: null,
      workOrder: null,
      messages: [],
    });

    const result = await getMessageThread(customer, "thread-1");

    expect(result.ok).toBe(true);
    expect(mocks.prisma.messageThread.update).not.toHaveBeenCalled();
    expect(mocks.prisma.message.updateMany).not.toHaveBeenCalled();
  });
});
