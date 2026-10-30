import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import {
  claimNextSmsMessage,
  enqueueSms,
  hasSmsConsent,
  processSmsMessage,
  setSmsConsent,
} from "@/server/sms";
import { recordInboundSms } from "@/server/messaging";
import {
  sendBookingConfirmedSms,
  sendWorkOrderEventSms,
} from "@/server/sms-events";
import type { ServiceActor } from "@/server/actor";

const describeIntegration = integrationEnabled ? describe : describe.skip;

const actor: ServiceActor = {
  id: "office-actor",
  name: "Kontor",
  email: "kontor@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: null,
  permissions: ["workorders.update", "customers.manage"],
  permissionsCustomized: true,
  roleDefinition: null,
};

describeIntegration("SMS: webhook, samtykke og kø", () => {
  let departmentId = "";
  let customerId = "";
  let contactId = "";
  let contactPhone = "";
  let workOrderId = "";
  let portalUserId = "";
  const phoneSuffix = `9${String(Date.now()).slice(-7)}`;

  beforeAll(async () => {
    process.env.SMS_PROVIDER = "console";
    delete process.env.SMS_ALLOWLIST;

    const department = await prisma.department.create({
      data: { name: unique("IT-sms-avd") },
    });
    departmentId = department.id;

    const officeUser = await prisma.user.create({
      data: {
        name: "SMS Kontor",
        email: `${unique("sms-kontor")}@example.test`,
        role: "OFFICE",
        isActive: true,
        departmentId,
        permissions: ["workorders.update", "customers.manage"],
        permissionsCustomized: true,
      },
    });
    actor.id = officeUser.id;
    actor.email = officeUser.email;

    const customer = await prisma.customer.create({
      data: { name: unique("IT-sms-kunde"), departmentId },
    });
    customerId = customer.id;

    const contact = await prisma.contact.create({
      data: {
        name: "SMS Kontakt",
        phone: `+47${phoneSuffix}`,
        locale: "nb",
        customerId,
      },
    });
    contactId = contact.id;
    contactPhone = contact.phone ?? "";

    const workOrder = await prisma.workOrder.create({
      data: {
        title: unique("IT-sms-oppdrag"),
        departmentId,
        customerId,
        contactId,
        scheduledFor: new Date("2026-11-02T00:00:00.000Z"),
      },
    });
    workOrderId = workOrder.id;

    const portalUser = await prisma.user.create({
      data: {
        name: "SMS Kunde",
        email: `${unique("sms-kunde")}@example.test`,
        role: "CUSTOMER",
        isActive: true,
        customerId,
        contactId,
      },
    });
    portalUserId = portalUser.id;

    actor.departmentId = departmentId;
  });

  afterAll(async () => {
    await prisma.smsMessage.deleteMany({
      where: { OR: [{ contactId }, { departmentId }] },
    });
    await prisma.message.deleteMany({
      where: { thread: { customerId } },
    });
    await prisma.messageThread.deleteMany({ where: { customerId } });
    await prisma.channelPreference.deleteMany({ where: { contactId } });
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.contact.deleteMany({ where: { id: contactId } });
    await prisma.user.deleteMany({ where: { id: actor.id } });
    await prisma.user.deleteMany({ where: { id: portalUserId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("lagrer en innkommende levering nøyaktig én gang", async () => {
    const providerId = unique("delivery");

    const first = await recordInboundSms({
      provider: "console",
      providerId,
      from: contactPhone,
      to: "+4700000000",
      body: "Hei, kan dere komme i morgen?",
    });

    expect(first.duplicate).toBe(false);
    expect(first.threadId).toBeTruthy();
    expect(first.contactId).toBe(contactId);

    const second = await recordInboundSms({
      provider: "console",
      providerId,
      from: contactPhone,
      to: "+4700000000",
      body: "Hei, kan dere komme i morgen?",
    });

    expect(second.duplicate).toBe(true);
    expect(second.threadId).toBe(first.threadId);

    expect(
      await prisma.smsMessage.count({ where: { providerId } }),
    ).toBe(1);
    expect(
      await prisma.message.count({ where: { threadId: first.threadId! } }),
    ).toBe(1);
  });

  it("respekterer STOP og START fra kunden", async () => {
    const stop = await recordInboundSms({
      provider: "console",
      providerId: unique("stop"),
      from: contactPhone,
      to: "+4700000000",
      body: "STOP",
    });
    expect(stop.consentAction).toBe("OPT_OUT");
    expect(await hasSmsConsent({ contactId })).toBe(false);

    const blocked = await enqueueSms({
      to: contactPhone,
      body: "Hei",
      contactId,
      departmentId,
    });
    expect(blocked).toMatchObject({ ok: false, reason: "forbidden" });

    const start = await recordInboundSms({
      provider: "console",
      providerId: unique("start"),
      from: contactPhone,
      to: "+4700000000",
      body: "START",
    });
    expect(start.consentAction).toBe("OPT_IN");
    expect(await hasSmsConsent({ contactId })).toBe(true);
  });

  it("lar bare én worker claim samme melding", async () => {
    await setSmsConsent(actor, {
      contactId,
      optedIn: true,
      source: "integration",
    });

    const queued = await enqueueSms({
      to: contactPhone,
      body: "Køtest",
      contactId,
      departmentId,
    });
    expect(queued.ok).toBe(true);

    const first = await claimNextSmsMessage("worker-1");
    expect(first?.id).toBe(queued.ok ? queued.data.id : "");
    expect(first?.status).toBe("SENDING");
    expect(first?.attempts).toBe(1);

    const second = await claimNextSmsMessage("worker-2");
    expect(second).toBeNull();

    const outcome = await processSmsMessage(first!);
    expect(outcome).toBe("sent");

    const stored = await prisma.smsMessage.findUnique({
      where: { id: first!.id },
      select: { status: true, providerId: true },
    });
    expect(stored?.status).toBe("SENT");
    expect(stored?.providerId).toMatch(/^console-/);
  });

  it("sender en hendelsesmal gjennom tråden og lagrer malnøkkelen", async () => {
    const result = await sendWorkOrderEventSms(actor, {
      workOrderId,
      eventKey: "VISIT_REMINDER",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await prisma.smsMessage.findFirst({
      where: {
        threadId: result.data.threadId,
        templateKey: "VISIT_REMINDER",
      },
      orderBy: { createdAt: "desc" },
      select: { status: true, body: true, contactId: true },
    });
    expect(stored?.status).toBe("QUEUED");
    expect(stored?.contactId).toBe(contactId);
    expect(stored?.body).toContain("SMS Kontakt");

    // Rydd køen før dead-letter-testen, slik at den henter riktig rad.
    await prisma.smsMessage.deleteMany({
      where: { threadId: result.data.threadId, templateKey: "VISIT_REMINDER" },
    });
  });

  it("kan sende bookingbekreftelsen med 5A-transaksjonen", async () => {
    const result = await prisma.$transaction((tx) =>
      sendBookingConfirmedSms(actor, workOrderId, {}, tx),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await prisma.smsMessage.findFirst({
      where: {
        threadId: result.data.threadId,
        templateKey: "BOOKING_CONFIRMED",
      },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    expect(stored?.status).toBe("QUEUED");

    await prisma.smsMessage.deleteMany({
      where: {
        threadId: result.data.threadId,
        templateKey: "BOOKING_CONFIRMED",
      },
    });
  });

  it("lar kunden bekrefte egen booking med samme transaksjon", async () => {
    const customerActor: ServiceActor = {
      id: portalUserId,
      name: "SMS Kunde",
      email: null,
      role: "CUSTOMER",
      isActive: true,
      departmentId: null,
      customerId,
      contactId,
      permissions: [],
      permissionsCustomized: false,
      roleDefinition: null,
    };

    const result = await prisma.$transaction((tx) =>
      sendBookingConfirmedSms(customerActor, workOrderId, {}, tx),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await prisma.smsMessage.findFirst({
      where: {
        threadId: result.data.threadId,
        templateKey: "BOOKING_CONFIRMED",
      },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    expect(stored?.status).toBe("QUEUED");

    await prisma.smsMessage.deleteMany({
      where: {
        threadId: result.data.threadId,
        templateKey: "BOOKING_CONFIRMED",
      },
    });
  });

  it("dead-letterer en melding som feiler tre ganger", async () => {
    const created = await prisma.smsMessage.create({
      data: {
        direction: "OUTBOUND",
        provider: "linkmobility",
        to: contactPhone,
        body: "Feiler",
        status: "QUEUED",
        attempts: 2,
        contactId,
        departmentId,
      },
    });

    const claimed = await claimNextSmsMessage("worker-3");
    expect(claimed?.id).toBe(created.id);
    expect(claimed?.attempts).toBe(3);

    const outcome = await processSmsMessage(claimed!);
    expect(outcome).toBe("dead_letter");

    const stored = await prisma.smsMessage.findUnique({
      where: { id: created.id },
      select: {
        status: true,
        deadLetteredAt: true,
        lockedAt: true,
      },
    });
    expect(stored?.status).toBe("DEAD_LETTER");
    expect(stored?.deadLetteredAt).toBeInstanceOf(Date);
    expect(stored?.lockedAt).toBeNull();
  });
});
