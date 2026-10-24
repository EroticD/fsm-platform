import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    customer: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contact: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
    contract: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    customerAttachment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    comment: { findMany: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    template: { findMany: vi.fn(), findUnique: vi.fn() },
    department: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    workOrder: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    report: { count: vi.fn() },
    $transaction: vi.fn(),
  },
  recurring: vi.fn(async () => ({ contractId: "contract" })),
  claimUpload: vi.fn(async () => ({ claimed: true })),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/recurring", () => ({
  generateRecurringWorkOrderForContract: mocks.recurring,
}));
vi.mock("@/lib/departments", () => ({
  getActiveDepartments: vi.fn(async () => []),
  getDefaultDepartmentId: vi.fn(async () => "dep-a"),
}));
vi.mock("@/lib/upload-access", () => ({ claimUpload: mocks.claimUpload }));
vi.mock("fs/promises", () => ({
  default: { access: vi.fn(async () => undefined) },
}));

import {
  addCustomerAttachment,
  createCustomer,
  deleteContact,
  toggleContract,
  updateContact,
} from "./customers";

const officePermissions = [
  "customers.view",
  "customers.manage",
  "equipment.view",
  "equipment.manage",
  "workorders.view",
];

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
    roleDefinition: { permissions: officePermissions },
    ...overrides,
  };
}

const admin = () => actor({ role: "ADMIN" });
const office = () => actor();
const technician = () =>
  actor({
    role: "TECHNICIAN",
    roleDefinition: { permissions: ["customers.view", "equipment.view"] },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) => callback(mocks.prisma),
  );
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.prisma.contact.findFirst.mockResolvedValue(null);
  mocks.prisma.customer.findFirst.mockImplementation(
    async (args: unknown) => mocks.prisma.customer.findUnique(args),
  );
  mocks.prisma.contract.findUnique.mockResolvedValue(null);
  mocks.claimUpload.mockResolvedValue({ claimed: true });
});

describe("kundetjenesten – autorisasjon", () => {
  it("nekter å opprette kunde uten customers.manage", async () => {
    const result = await createCustomer(technician(), { name: "Ny kunde" });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("nekter å oppdatere kontaktperson på en annen kunde", async () => {
    mocks.prisma.contact.findFirst.mockResolvedValue(null);
  mocks.prisma.customer.findFirst.mockImplementation(
    async (args: unknown) => mocks.prisma.customer.findUnique(args),
  );

    const result = await updateContact(office(), "kunde-1", {
      id: "kontakt-fra-kunde-2",
      name: "Kari",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: "kontakt-fra-kunde-2", customerId: "kunde-1" },
      select: { id: true },
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("nekter å endre serviceavtale i en annen avdeling", async () => {
    mocks.prisma.contract.findUnique.mockResolvedValue({
      id: "avtale-1",
      customerId: "kunde-1",
      departmentId: "dep-b",
      title: "Årlig service",
    });

    const result = await toggleContract(office(), "kunde-1", {
      id: "avtale-1",
      active: "false",
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lar administrator slette kontaktperson, men ikke kontor", async () => {
    const denied = await deleteContact(office(), "kunde-1", { id: "kontakt-1" });
    expect(denied).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.contact.findFirst).not.toHaveBeenCalled();

    mocks.prisma.contact.findFirst.mockResolvedValue({
      id: "kontakt-1",
      customerId: "kunde-1",
      name: "Kari",
    });
    const allowed = await deleteContact(admin(), "kunde-1", { id: "kontakt-1" });
    expect(allowed.ok).toBe(true);
  });
});

describe("kundetjenesten – revisjon og transaksjon", () => {
  it("ruller tilbake kunden når revisjonsloggen feiler", async () => {
    const committed: string[] = [];
    const auditCreate = vi.fn(async () => {
      throw new Error("revisjonsloggen feilet");
    });

    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) => {
        const pending: string[] = [];
        const tx = {
          customer: {
            create: vi.fn(async ({ data }: { data: { name: string } }) => {
              const row = { id: "kunde-1", ...data };
              pending.push(row.id);
              return row;
            }),
          },
          auditLog: { create: auditCreate },
        };
        const result = await callback(tx);
        committed.push(...pending);
        return result;
      },
    );

    const result = await createCustomer(admin(), { name: "Kunde AS" });

    expect(result).toEqual({ ok: false, reason: "error" });
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(committed).toHaveLength(0);
  });
});

describe("kundetjenesten – kundeverlegg", () => {
  it("avviser vedlegget når brukeren ikke eier filen", async () => {
    mocks.claimUpload.mockResolvedValue({ claimed: false });
    mocks.prisma.customer.findUnique.mockResolvedValue({
      id: "kunde-1",
      departmentId: "dep-a",
    });
    mocks.prisma.customerAttachment.findFirst.mockResolvedValue(null);

    const result = await addCustomerAttachment(office(), {
      customerId: "kunde-1",
      fileUrl: "/uploads/lant.pdf",
      fileName: "lant.pdf",
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.customerAttachment.create).not.toHaveBeenCalled();
    expect(mocks.prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
