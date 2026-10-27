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
    user: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
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
  deleteCustomer,
  getCustomerDetail,
  restoreCustomer,
  toggleContract,
  updateContact,
  updateCustomer,
} from "./customers";

const officePermissions = [
  "customers.view",
  "customers.manage",
  "equipment.view",
  "equipment.manage",
  "reports.view",
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

function detailCustomer() {
  return {
    id: "kunde-1",
    name: "Kunde AS",
    customerNumber: null,
    orgNumber: null,
    department: null,
    responsibleTechnician: null,
    contacts: [],
    contracts: [],
    attachments: [],
    _count: { contacts: 0, contracts: 0, products: 0, attachments: 0 },
  };
}

describe("kundetjenesten – kundekortets datatilgang", () => {
  beforeEach(() => {
    mocks.prisma.customer.findFirst.mockResolvedValue(detailCustomer());
    mocks.prisma.product.findMany.mockResolvedValue([]);
    mocks.prisma.auditLog.findMany.mockResolvedValue([]);
    mocks.prisma.comment.findMany.mockResolvedValue([]);
    mocks.prisma.user.findMany.mockResolvedValue([]);
    mocks.prisma.template.findMany.mockResolvedValue([]);
    mocks.prisma.workOrder.findMany.mockResolvedValue([]);
    mocks.prisma.workOrder.count.mockResolvedValue(0);
    mocks.prisma.workOrder.findFirst.mockResolvedValue(null);
    mocks.prisma.report.count.mockResolvedValue(0);
  });

  it("avgrenser rapportenhetene til aktørens oppdrag og krever reports.view", async () => {
    await getCustomerDetail(office(), "kunde-1", {
      tab: "enheter",
      orderPage: 1,
    });

    const args = mocks.prisma.product.findMany.mock.calls[0][0] as {
      include: {
        reportUnits: { where: { report: { workOrder: unknown } } };
      };
    };
    expect(JSON.stringify(args.include.reportUnits.where)).toContain(
      '"departmentId":"dep-a"',
    );
    expect(JSON.stringify(args.include.reportUnits.where)).toContain(
      '"deletedAt":null',
    );
  });

  it("gir ingen rapportenheter uten reports.view", async () => {
    await getCustomerDetail(technician(), "kunde-1", {
      tab: "enheter",
      orderPage: 1,
    });

    const args = mocks.prisma.product.findMany.mock.calls[0][0] as {
      include: {
        reportUnits: { where: unknown };
        _count: { select: { reportUnits: { where: unknown } } };
      };
    };
    expect(args.include.reportUnits.where).toEqual({ id: { in: [] } });
    expect(args.include._count.select.reportUnits.where).toEqual({
      id: { in: [] },
    });
  });

  it("laster ikke enheter for aktører uten equipment.view", async () => {
    const noEquipment = actor({
      roleDefinition: { permissions: ["customers.view", "reports.view"] },
    });

    await getCustomerDetail(noEquipment, "kunde-1", {
      tab: "enheter",
      orderPage: 1,
    });

    expect(mocks.prisma.product.findMany).not.toHaveBeenCalled();
  });

  it("viser bare kundens egne revisjonsrader – ikke oppdrag fra andre avdelinger", async () => {
    await getCustomerDetail(office(), "kunde-1", {
      tab: "aktivitet",
      orderPage: 1,
    });

    expect(mocks.prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { entityType: "Customer", entityId: "kunde-1" },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });
});

describe("kundetjenesten – validering av referanser", () => {
  it("avviser en kundeoppdatering med ukjent avdeling", async () => {
    mocks.prisma.department.findFirst.mockResolvedValue(null);

    const result = await updateCustomer(office(), "kunde-1", {
      name: "Kunde AS",
      departmentId: "finnes-ikke",
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("avviser en inaktiv eller ukjent ansvarlig montør", async () => {
    mocks.prisma.department.findFirst.mockResolvedValue({ id: "dep-a" });
    mocks.prisma.user.findFirst.mockResolvedValue(null);

    const result = await updateCustomer(office(), "kunde-1", {
      name: "Kunde AS",
      departmentId: "dep-a",
      responsibleTechnicianId: "inaktiv-bruker",
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "inaktiv-bruker",
          isActive: true,
        }),
      }),
    );
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("validerer referanser også når kunden opprettes", async () => {
    mocks.prisma.department.findFirst.mockResolvedValue(null);

    const result = await createCustomer(office(), {
      name: "Kunde AS",
      departmentId: "finnes-ikke",
    });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("kundetjenesten – myk sletting og gjenoppretting", () => {
  it("nekter sletting for andre enn administrator", async () => {
    const result = await deleteCustomer(office(), "kunde-1");

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.customer.update).not.toHaveBeenCalled();
  });

  it("myksletter kunden med uforanderlig aktør-id i revisjonsloggen", async () => {
    mocks.prisma.customer.findFirst.mockResolvedValue({
      id: "kunde-1",
      name: "Kunde AS",
    });

    const result = await deleteCustomer(admin(), "kunde-1");

    expect(result.ok).toBe(true);
    expect(mocks.prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "kunde-1" },
      data: {
        deletedAt: expect.any(Date),
        deletedBy: "Actor",
      },
    });
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: "Customer",
        entityId: "kunde-1",
        actorId: "actor",
      }),
    });
  });

  it("gjenoppretter bare en kunde som faktisk er slettet", async () => {
    mocks.prisma.customer.findUnique.mockResolvedValue({
      id: "kunde-1",
      name: "Kunde AS",
      deletedAt: new Date(),
    });

    const result = await restoreCustomer(admin(), "kunde-1");

    expect(result.ok).toBe(true);
    expect(mocks.prisma.customer.update).toHaveBeenCalledWith({
      where: { id: "kunde-1" },
      data: { deletedAt: null, deletedBy: null },
    });
  });

  it("nekter gjenoppretting for kontor", async () => {
    const result = await restoreCustomer(office(), "kunde-1");

    expect(result).toEqual({ ok: false, reason: "forbidden" });
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
