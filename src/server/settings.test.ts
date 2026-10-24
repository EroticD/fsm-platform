import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    branding: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    template: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    tag: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    documentTag: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    department: { findMany: vi.fn() },
    role: { findMany: vi.fn() },
    upload: { findUnique: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    user: { findMany: vi.fn() },
    customer: { findMany: vi.fn() },
    workOrder: { count: vi.fn(), groupBy: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));

import {
  createTemplate,
  getStatistics,
  saveBranding,
} from "./settings";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "actor",
    name: "Actor",
    email: "actor@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: {
      permissions: ["templates.manage", "documents.manage", "reports.view"],
    },
    ...overrides,
  };
}

const admin = () => actor({ role: "ADMIN" });
const office = () => actor();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
  );
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.prisma.branding.findFirst.mockResolvedValue({ id: "branding-1" });
  mocks.prisma.branding.update.mockResolvedValue({ id: "branding-1" });
  mocks.prisma.template.create.mockResolvedValue({ id: "template-1" });
  mocks.prisma.upload.findUnique.mockResolvedValue(null);
});

describe("innstillingstjenesten – autorisasjon", () => {
  it("nekter å lagre merkevare uten settings.manage", async () => {
    const result = await saveBranding(office(), {
      companyName: "Nytt navn",
      primaryColor: "#2563eb",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("nekter statistikk uten reports.view", async () => {
    const result = await getStatistics(
      actor({ roleDefinition: { permissions: [] } }),
      { dateFrom: "", dateTo: "", status: "", customer: "", technician: "" },
    );

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.workOrder.count).not.toHaveBeenCalled();
  });

  it("avviser eksterne logo-URL-er", async () => {
    const result = await saveBranding(admin(), {
      companyName: "Nytt navn",
      logoUrl: "https://intern.tjeneste/logo.png",
    });

    expect(result).toEqual({ ok: false, reason: "invalid_logo" });
    expect(mocks.prisma.branding.update).not.toHaveBeenCalled();
  });
});

describe("innstillingstjenesten – logo må eies av avsenderen", () => {
  const logo = "/uploads/11111111-1111-4111-8111-111111111111.png";

  it.each(["WORK_ORDER", "USER", "CUSTOMER", "DOCUMENT"])(
    "avviser en logo som tilhører %s",
    async (ownerType) => {
      mocks.prisma.upload.findUnique.mockResolvedValue({
        ownerType,
        uploadedById: "actor",
      });

      const result = await saveBranding(admin(), {
        companyName: "Nytt navn",
        logoUrl: logo,
      });

      expect(result).toEqual({ ok: false, reason: "invalid_logo" });
      expect(mocks.prisma.branding.update).not.toHaveBeenCalled();
    },
  );

  it("avviser en logo som mangler opplastingsrad", async () => {
    mocks.prisma.upload.findUnique.mockResolvedValue(null);

    const result = await saveBranding(admin(), {
      companyName: "Nytt navn",
      logoUrl: logo,
    });

    expect(result).toEqual({ ok: false, reason: "invalid_logo" });
    expect(mocks.prisma.branding.update).not.toHaveBeenCalled();
  });

  it("avviser en merkevarelogo som er lastet opp av en annen bruker", async () => {
    mocks.prisma.upload.findUnique.mockResolvedValue({
      ownerType: "BRANDING",
      uploadedById: "noen-andre",
    });

    const result = await saveBranding(admin(), {
      companyName: "Nytt navn",
      logoUrl: logo,
    });

    expect(result).toEqual({ ok: false, reason: "invalid_logo" });
    expect(mocks.prisma.branding.update).not.toHaveBeenCalled();
  });

  it("lagrer en merkevarelogo som er lastet opp av samme bruker", async () => {
    mocks.prisma.upload.findUnique.mockResolvedValue({
      ownerType: "BRANDING",
      uploadedById: "actor",
    });

    const result = await saveBranding(admin(), {
      companyName: "Nytt navn",
      logoUrl: logo,
    });

    expect(result).toEqual({ ok: true, data: { id: "branding-1" } });
    expect(mocks.prisma.upload.findUnique).toHaveBeenCalledWith({
      where: { storedName: "11111111-1111-4111-8111-111111111111.png" },
      select: { ownerType: true, uploadedById: true },
    });
    expect(mocks.prisma.branding.update).toHaveBeenCalledWith({
      where: { id: "branding-1" },
      data: expect.objectContaining({ logoUrl: logo }),
    });
  });
});

describe("innstillingstjenesten – revisjon", () => {
  it("skriver revisjonslogg i samme transaksjon som malen", async () => {
    const auditCreate = vi.fn(async () => ({}));
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          template: { create: vi.fn(async () => ({ id: "template-1" })) },
          auditLog: { create: auditCreate },
        }),
    );

    const result = await createTemplate(office(), { title: "Årlig service" });

    expect(result).toEqual({ ok: true, data: { id: "template-1" } });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "Template",
        entityId: "template-1",
      }),
    });
  });

  it("ruller tilbake merkevaren når revisjonsloggen feiler", async () => {
    const committed: string[] = [];
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        const pending: string[] = [];
        const tx = {
          branding: {
            update: vi.fn(async () => {
              pending.push("branding");
              return { id: "branding-1" };
            }),
            create: vi.fn(),
          },
          auditLog: {
            create: vi.fn(async () => {
              throw new Error("revisjonsloggen feilet");
            }),
          },
        };
        const result = await callback(tx);
        committed.push(...pending);
        return result;
      },
    );

    await expect(
      saveBranding(admin(), { companyName: "Nytt navn" }),
    ).rejects.toThrow("revisjonsloggen feilet");
    expect(committed).toHaveLength(0);
  });
});
