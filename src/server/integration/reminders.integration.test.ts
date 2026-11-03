import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import {
  processReminderDispatches,
  scheduleDueReminders,
} from "@/server/reminders";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("Påminnelser: planlegging, idempotens og avlysning", () => {
  let departmentId = "";
  let customerId = "";
  let contactId = "";
  let workOrderId = "";
  let ruleId = "";
  let consentId = "";

  beforeAll(async () => {
    process.env.SMS_PROVIDER = "console";
    delete process.env.SMS_ALLOWLIST;

    const department = await prisma.department.create({
      data: { name: unique("IT-paaminnelse-avd") },
    });
    departmentId = department.id;

    const customer = await prisma.customer.create({
      data: { name: unique("IT-paaminnelse-kunde"), departmentId },
    });
    customerId = customer.id;

    const contact = await prisma.contact.create({
      data: {
        customerId,
        name: "Påminnelses Kontakt",
        phone: `+47${String(Date.now()).slice(-8)}`,
        email: `${unique("paaminnelse")}@example.test`,
        locale: "nb",
      },
    });
    contactId = contact.id;

    const consent = await prisma.channelPreference.create({
      data: {
        contactId,
        channel: "SMS",
        optedIn: true,
        optedOut: false,
        consentedAt: new Date(),
        source: "integration",
      },
    });
    consentId = consent.id;

    const workOrder = await prisma.workOrder.create({
      data: {
        reference: unique("REF-PAAMINNELSE"),
        title: unique("IT-paaminnelse-oppdrag"),
        departmentId,
        customerId,
        contactId,
      },
    });
    workOrderId = workOrder.id;

    const rule = await prisma.reminderRule.create({
      data: {
        departmentId,
        channel: "SMS",
        offsetHours: 1,
        templateKey: "VISIT_REMINDER",
        maxPerVisit: 2,
      },
    });
    ruleId = rule.id;
  });

  afterAll(async () => {
    await prisma.reminderDispatch.deleteMany({ where: { departmentId } });
    await prisma.smsMessage.deleteMany({ where: { departmentId } });
    await prisma.message.deleteMany({ where: { thread: { customerId } } });
    await prisma.messageThread.deleteMany({ where: { customerId } });
    await prisma.reminderRule.deleteMany({ where: { id: ruleId } });
    await prisma.workOrder.deleteMany({ where: { id: workOrderId } });
    await prisma.channelPreference.deleteMany({ where: { id: consentId } });
    await prisma.contact.deleteMany({ where: { id: contactId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("planlegger bare én rad per regel, visit og starttid", async () => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 60 * 60_000);
    await prisma.visit.create({
      data: {
        workOrderId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        status: "PLANNED",
      },
    });

    const first = await scheduleDueReminders(now);
    expect(first.scheduled).toBeGreaterThanOrEqual(1);

    const second = await scheduleDueReminders(now);
    expect(second.scheduled).toBe(0);

    expect(
      await prisma.reminderDispatch.count({
        where: { departmentId, ruleId, status: "SCHEDULED" },
      }),
    ).toBe(1);
  });

  it("sender påminnelsen gjennom SMS-køen og markerer raden som sendt", async () => {
    const processed = await processReminderDispatches(10);
    expect(processed.sent).toBeGreaterThanOrEqual(1);

    const dispatch = await prisma.reminderDispatch.findFirst({
      where: { departmentId, ruleId },
      orderBy: { createdAt: "desc" },
      select: { status: true, smsMessageId: true, attempts: true },
    });
    expect(dispatch?.status).toBe("SENT");
    expect(dispatch?.smsMessageId).toBeTruthy();

    const sms = await prisma.smsMessage.findUnique({
      where: { id: dispatch?.smsMessageId ?? "" },
      select: { status: true, templateKey: true, contactId: true },
    });
    expect(sms).toMatchObject({
      status: "QUEUED",
      templateKey: "VISIT_REMINDER",
      contactId,
    });
  });

  it("hopper over og forklarer når besøket avlyses", async () => {
    const now = new Date();
    const startsAt = new Date(now.getTime() + 60 * 60_000);
    const visit = await prisma.visit.create({
      data: {
        workOrderId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60_000),
        status: "PLANNED",
      },
    });

    await scheduleDueReminders(now);
    await prisma.visit.update({
      where: { id: visit.id },
      data: { status: "CANCELLED" },
    });

    await processReminderDispatches(10);
    const dispatch = await prisma.reminderDispatch.findFirst({
      where: { visitId: visit.id },
      select: { status: true, skipReason: true },
    });
    expect(dispatch).toMatchObject({
      status: "SKIPPED",
      skipReason: "visit_cancelled",
    });
  });
});
