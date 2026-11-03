import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    reminderRule: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    reminderDispatch: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    visit: { findMany: vi.fn(), findUnique: vi.fn() },
    channelPreference: { findUnique: vi.fn() },
    branding: { findFirst: vi.fn() },
    messageThread: { upsert: vi.fn() },
    message: { create: vi.fn() },
    department: { findMany: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
  enqueueSms: vi.fn(),
  hasSmsConsent: vi.fn(),
  renderEventSms: vi.fn(),
  sendNotificationEmail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/email", () => ({
  sendNotificationEmail: mocks.sendNotificationEmail,
}));
vi.mock("./messaging", () => ({
  messageThreadKey: vi.fn(() => "thread-key"),
}));
vi.mock("./sms", () => ({
  enqueueSms: mocks.enqueueSms,
  hasSmsConsent: mocks.hasSmsConsent,
  renderEventSms: mocks.renderEventSms,
}));

import {
  processReminderDispatch,
  saveReminderRule,
  scheduleDueReminders,
} from "./reminders";

const admin: ServiceActor = {
  id: "admin-1",
  name: "Admin",
  email: "admin@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: null,
  permissions: ["settings.manage"],
  permissionsCustomized: true,
  roleDefinition: null,
};

const rule = {
  id: "rule-1",
  departmentId: "dep-1",
  channel: "SMS",
  offsetHours: 24,
  templateKey: "VISIT_REMINDER",
  quietStartHour: null,
  quietEndHour: null,
  timezone: "Europe/Oslo",
  maxPerVisit: 2,
  isActive: true,
};

const now = new Date("2026-07-01T10:00:00.000Z"); // 12:00 Oslo
const visit = {
  id: "visit-1",
  startsAt: new Date("2026-07-02T10:00:00.000Z"), // 24 timer senere
  workOrder: {
    id: "wo-1",
    title: "Service",
    reference: "O-1",
    customerId: "customer-1",
    contactId: "contact-1",
    departmentId: "dep-1",
    technicians: [{ name: "Montør" }],
    customer: {
      id: "customer-1",
      name: "Kunde AS",
      email: "kunde@example.test",
      contacts: [
        {
          id: "contact-1",
          name: "Kari",
          phone: "+4790000000",
          email: "kari@example.test",
          locale: "nb",
        },
      ],
    },
    contact: {
      id: "contact-1",
      name: "Kari",
      phone: "+4790000000",
      email: "kari@example.test",
      locale: "nb",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.reminderRule.findMany.mockResolvedValue([rule]);
  mocks.prisma.reminderRule.findFirst.mockResolvedValue({
    id: "rule-1",
    departmentId: "dep-1",
    offsetHours: 24,
    channel: "SMS",
    department: { name: "Avdeling" },
  });
  mocks.prisma.reminderRule.findUnique.mockResolvedValue({
    isActive: true,
    templateKey: "VISIT_REMINDER",
  });
  mocks.prisma.reminderRule.create.mockResolvedValue({ id: "rule-new" });
  mocks.prisma.department.findFirst.mockResolvedValue({
    id: "dep-1",
    name: "Avdeling",
  });
  mocks.prisma.department.findMany.mockResolvedValue([
    { id: "dep-1", name: "Avdeling" },
  ]);
  mocks.prisma.visit.findMany.mockResolvedValue([visit]);
  mocks.prisma.reminderDispatch.findUnique.mockResolvedValue(null);
  mocks.prisma.reminderDispatch.create.mockResolvedValue({ id: "dispatch-1" });
  mocks.prisma.reminderDispatch.count.mockResolvedValue(0);
  mocks.prisma.reminderDispatch.update.mockResolvedValue({});
  mocks.prisma.reminderDispatch.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.channelPreference.findUnique.mockResolvedValue(null);
  mocks.prisma.branding.findFirst.mockResolvedValue({
    companyName: "Bedriften",
  });
  mocks.prisma.messageThread.upsert.mockResolvedValue({ id: "thread-1" });
  mocks.prisma.message.create.mockResolvedValue({ id: "message-1" });
  mocks.prisma.$transaction.mockImplementation(
    async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: unknown) => unknown)(mocks.prisma)
        : Promise.all(arg as Promise<unknown>[]),
  );
  mocks.hasSmsConsent.mockResolvedValue(true);
  mocks.enqueueSms.mockResolvedValue({ ok: true, data: { id: "sms-1" } });
  mocks.renderEventSms.mockResolvedValue({
    ok: true,
    data: { body: "Påminnelse", locale: "nb" },
  });
  mocks.sendNotificationEmail.mockResolvedValue(true);
});

describe("påminnelsesregler", () => {
  it("avviser vanlige brukere uten settings.manage", async () => {
    const result = await saveReminderRule(
      { ...admin, role: "OFFICE", permissions: [], departmentId: "dep-1" },
      { departmentId: "dep-1", channel: "SMS", offsetHours: 24 },
    );
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("avviser ugyldig stille-vindu og offset", async () => {
    const result = await saveReminderRule(admin, {
      departmentId: "dep-1",
      channel: "SMS",
      offsetHours: 0,
      quietStartHour: 22,
      quietEndHour: null,
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("lar ikke en avdelingsbruker oppdatere en regel i en annen avdeling", async () => {
    mocks.prisma.reminderRule.findFirst.mockResolvedValue(null);
    const result = await saveReminderRule(
      {
        ...admin,
        role: "OFFICE",
        departmentId: "dep-2",
        permissions: ["settings.manage"],
      },
      {
        id: "rule-other",
        departmentId: "dep-2",
        channel: "SMS",
        offsetHours: 24,
        templateKey: "VISIT_REMINDER",
      },
    );
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(mocks.prisma.reminderRule.update).not.toHaveBeenCalled();
  });

  it("lagrer en gyldig regel og skriver revisjon", async () => {
    const result = await saveReminderRule(admin, {
      departmentId: "dep-1",
      channel: "BOTH",
      offsetHours: 2,
      templateKey: "VISIT_REMINDER",
      quietStartHour: 22,
      quietEndHour: 7,
      timezone: "Europe/Oslo",
      maxPerVisit: 2,
    });
    expect(result.ok).toBe(true);
    expect(mocks.prisma.reminderRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: "BOTH",
          offsetHours: 2,
          quietStartHour: 22,
          quietEndHour: 7,
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalled();
  });
});

describe("planlegging av påminnelser", () => {
  it("planlegger 24-timerspåminnelse for kommende visit", async () => {
    const result = await scheduleDueReminders(now);
    expect(result.scheduled).toBe(1);
    expect(mocks.prisma.reminderDispatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ruleId: "rule-1",
          visitId: "visit-1",
          channel: "SMS",
          status: "SCHEDULED",
          offsetHours: 24,
        }),
      }),
    );
  });

  it("planlegger ikke samme regel, visit og starttid to ganger", async () => {
    mocks.prisma.reminderDispatch.findUnique.mockResolvedValue({
      id: "existing",
    });
    const result = await scheduleDueReminders(now);
    expect(result.scheduled).toBe(0);
    expect(mocks.prisma.reminderDispatch.create).not.toHaveBeenCalled();
  });

  it("respekterer maks antall påminnelser per visit", async () => {
    mocks.prisma.reminderDispatch.count.mockResolvedValue(2);
    await scheduleDueReminders(now);
    expect(mocks.prisma.reminderDispatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED",
          skipReason: "max_per_visit",
        }),
      }),
    );
  });

  it("hopper over når kunden ikke har SMS-samtykke", async () => {
    mocks.hasSmsConsent.mockResolvedValue(false);
    const result = await scheduleDueReminders(now);
    expect(result.scheduled).toBe(0);
    expect(mocks.prisma.reminderDispatch.create).not.toHaveBeenCalled();
  });

  it("flytter eller hopper over påminnelse i stille timer", async () => {
    const lateNow = new Date("2026-07-01T21:00:00.000Z"); // 23:00 Oslo
    const lateVisit = {
      ...visit,
      id: "visit-late",
      startsAt: new Date("2026-07-01T23:00:00.000Z"), // 01:00 Oslo
    };
    mocks.prisma.reminderRule.findMany.mockResolvedValue([
      { ...rule, offsetHours: 2, quietStartHour: 22, quietEndHour: 7 },
    ]);
    mocks.prisma.visit.findMany.mockResolvedValue([lateVisit]);

    await scheduleDueReminders(lateNow);
    expect(mocks.prisma.reminderDispatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED",
          skipReason: "quiet_hours",
        }),
      }),
    );
  });
});

describe("utsending av påminnelser", () => {
  const dispatch = {
    id: "dispatch-1",
    ruleId: "rule-1",
    visitId: "visit-1",
    departmentId: "dep-1",
    workOrderId: "wo-1",
    customerId: "customer-1",
    contactId: "contact-1",
    channel: "SMS",
    offsetHours: 24,
    locale: "nb",
    status: "PROCESSING",
    scheduledFor: new Date("2026-07-01T10:00:00.000Z"),
    visitStartsAt: visit.startsAt,
    attempts: 1,
    smsMessageId: null,
  };

  function visitRow(overrides: Record<string, unknown> = {}) {
    return {
      status: "PLANNED",
      startsAt: visit.startsAt,
      workOrder: {
        ...visit.workOrder,
        status: "PLANNED",
        deletedAt: null,
      },
      ...overrides,
    };
  }

  it("sender med mottakerens språk og lagrer SMS i tråden", async () => {
    const localizedVisit = visitRow();
    localizedVisit.workOrder.contact.locale = "pl";
    localizedVisit.workOrder.customer.contacts[0].locale = "pl";
    mocks.prisma.visit.findUnique.mockResolvedValue(localizedVisit);

    const outcome = await processReminderDispatch(dispatch);

    expect(outcome).toBe("sent");
    expect(mocks.renderEventSms).toHaveBeenCalledWith(
      "VISIT_REMINDER",
      "pl",
      expect.any(Object),
    );
    expect(mocks.enqueueSms).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+4790000000",
        locale: "pl",
        templateKey: "VISIT_REMINDER",
      }),
    );
    expect(mocks.prisma.message.create).toHaveBeenCalled();
  });

  it("hopper over når besøket er flyttet", async () => {
    mocks.prisma.visit.findUnique.mockResolvedValue(
      visitRow({ startsAt: new Date("2026-07-03T10:00:00.000Z") }),
    );

    const outcome = await processReminderDispatch(dispatch);

    expect(outcome).toBe("skipped");
    expect(mocks.prisma.reminderDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SKIPPED",
          skipReason: "visit_moved",
        }),
      }),
    );
    expect(mocks.enqueueSms).not.toHaveBeenCalled();
  });

  it("hopper over når besøket eller oppdraget er avlyst", async () => {
    mocks.prisma.visit.findUnique.mockResolvedValue(
      visitRow({ status: "CANCELLED" }),
    );

    const outcome = await processReminderDispatch(dispatch);

    expect(outcome).toBe("skipped");
    expect(mocks.prisma.reminderDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ skipReason: "visit_cancelled" }),
      }),
    );
    expect(mocks.enqueueSms).not.toHaveBeenCalled();
  });

  it("hopper over når samtykket er trukket", async () => {
    mocks.prisma.visit.findUnique.mockResolvedValue(visitRow());
    mocks.hasSmsConsent.mockResolvedValue(false);

    const outcome = await processReminderDispatch(dispatch);

    expect(outcome).toBe("skipped");
    expect(mocks.prisma.reminderDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ skipReason: "no_consent" }),
      }),
    );
    expect(mocks.enqueueSms).not.toHaveBeenCalled();
  });
});
