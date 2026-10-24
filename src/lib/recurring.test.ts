import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    contract: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    workOrder: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    attachment: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/report-pdf-store", () => ({
  getOrRenderReportPdf: vi.fn(),
}));

import prisma from "@/lib/prisma";
import { getOrRenderReportPdf } from "@/lib/report-pdf-store";
import {
  generateDueRecurringWorkOrders,
  generateRecurringWorkOrderForContract,
} from "./recurring";

const mocked = prisma as unknown as {
  contract: { findUnique: Mock; findMany: Mock; updateMany: Mock };
  workOrder: { findFirst: Mock; create: Mock; update: Mock };
  auditLog: { create: Mock };
  attachment: { create: Mock };
  $transaction: Mock;
};
const mockedPdfStore = vi.mocked(getOrRenderReportPdf);

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: "contract-1",
    title: "Årlig service",
    intervalMonths: 12,
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    nextServiceDate: new Date("2026-01-01T00:00:00.000Z"),
    isActive: true,
    customerId: "customer-1",
    departmentId: "dept-1",
    contactId: null,
    templateId: null,
    customer: { contacts: [] },
    ...overrides,
  };
}

/** Kobler $transaction til en falsk transaksjonsklient. */
function useTransaction(tx: Record<string, unknown>) {
  mocked.$transaction.mockImplementation(
    async (arg: unknown) => {
      if (typeof arg === "function") {
        return (arg as (client: unknown) => unknown)(tx);
      }
      return Promise.all(arg as Promise<unknown>[]);
    },
  );
}

const now = new Date("2026-06-01T00:00:00.000Z");

describe("generateDueRecurringWorkOrders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returnerer tom liste når advisory-låsen er opptatt", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ locked: false }]);
    useTransaction({ $queryRaw: queryRaw });

    const results = await generateDueRecurringWorkOrders(now);

    expect(results).toEqual([]);
    expect(mocked.contract.findMany).not.toHaveBeenCalled();
    // Låsen ble aldri tatt, så den skal heller ikke frigjøres.
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("frigjør låsen etter kjøringen", async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ ok: true }]);
    useTransaction({ $queryRaw: queryRaw });
    mocked.contract.findMany.mockResolvedValue([]);

    await generateDueRecurringWorkOrders(now);

    expect(mocked.contract.findMany).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe("generateRecurringWorkOrderForContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.$transaction.mockReset();
    mockedPdfStore.mockReset();
    mocked.contract.findUnique.mockResolvedValue(contract());
    mocked.workOrder.findFirst.mockResolvedValue(null);
  });

  it("oppretter oppdraget når avtalen er forfalt", async () => {
    const tx = {
      contract: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      workOrder: { create: vi.fn().mockResolvedValue({ id: "wo-new" }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    useTransaction(tx);

    const result = await generateRecurringWorkOrderForContract("contract-1", now);

    expect(result).toMatchObject({
      contractId: "contract-1",
      workOrderId: "wo-new",
      scheduledFor: "2026-01-01T00:00:00.000Z",
    });
    expect(tx.contract.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ nextServiceDate: contract().nextServiceDate }),
      }),
    );
    // Ingen tidligere rapport: verken PDF eller vedlegg.
    expect(mocked.attachment.create).not.toHaveBeenCalled();
  });

  it("behandler unikhetskollisjon som «allerede generert»", async () => {
    mocked.$transaction.mockRejectedValue({ code: "P2002" });

    const result = await generateRecurringWorkOrderForContract("contract-1", now);

    expect(result).toEqual({
      contractId: "contract-1",
      skipped: "already-generated",
    });
  });

  it("legger ved forrige rapport først etter at oppdraget er opprettet", async () => {
    mocked.workOrder.findFirst.mockResolvedValue({
      id: "wo-previous",
      scheduledFor: new Date("2025-01-01T00:00:00.000Z"),
    });
    mockedPdfStore.mockResolvedValue({
      buffer: Buffer.from("%PDF"),
      fileName: "servicerapport",
      url: "/uploads/previous.pdf",
    });
    mocked.attachment.create.mockResolvedValue({});
    mocked.workOrder.update.mockResolvedValue({});

    const tx = {
      contract: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      workOrder: { create: vi.fn().mockResolvedValue({ id: "wo-new" }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    useTransaction(tx);

    const result = await generateRecurringWorkOrderForContract("contract-1", now);

    expect(result.workOrderId).toBe("wo-new");
    expect(mockedPdfStore).toHaveBeenCalledWith("wo-previous");
    expect(mocked.attachment.create).toHaveBeenCalledWith({
      data: {
        workOrderId: "wo-new",
        fileName: "Servicerapport-2025-01-01.pdf",
        dataUrl: "/uploads/previous.pdf",
      },
    });
  });

  it("beholder oppdraget når vedlegget ikke kan lages", async () => {
    mocked.workOrder.findFirst.mockResolvedValue({
      id: "wo-previous",
      scheduledFor: new Date("2025-01-01T00:00:00.000Z"),
    });
    mockedPdfStore.mockRejectedValue(new Error("PDF feilet"));

    const tx = {
      contract: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      workOrder: { create: vi.fn().mockResolvedValue({ id: "wo-new" }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    useTransaction(tx);

    const result = await generateRecurringWorkOrderForContract("contract-1", now);

    expect(result.workOrderId).toBe("wo-new");
    expect(mocked.attachment.create).not.toHaveBeenCalled();
  });

  it("hopper over avtaler som ikke er forfalt", async () => {
    mocked.contract.findUnique.mockResolvedValue(
      contract({ nextServiceDate: new Date("2027-01-01T00:00:00.000Z") }),
    );

    const result = await generateRecurringWorkOrderForContract("contract-1", now);

    expect(result).toEqual({ contractId: "contract-1", skipped: "not-due" });
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});
