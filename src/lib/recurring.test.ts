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
    customer: { contacts: [], deletedAt: null },
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

/** Transaksjonsklient for den korte krav-/opprett-transaksjonen. */
function claimTransaction(overrides: Record<string, unknown> = {}) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
    contract: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    workOrder: { create: vi.fn().mockResolvedValue({ id: "wo-new" }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

/** SQL-teksten fra en tagget `$queryRaw`-kall. */
function rawSql(queryRaw: Mock, index = 0): string {
  const call = queryRaw.mock.calls[index];
  return (call[0] as TemplateStringsArray).join("?");
}

const now = new Date("2026-06-01T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocked.$transaction.mockReset();
  mockedPdfStore.mockReset();
  mocked.contract.findUnique.mockResolvedValue(contract());
  mocked.contract.findMany.mockResolvedValue([]);
  mocked.workOrder.findFirst.mockResolvedValue(null);
});

describe("generateDueRecurringWorkOrders", () => {
  it("filtrerer bort avtaler for mykt slettede kunder", async () => {
    await generateDueRecurringWorkOrders(now);

    expect(mocked.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: true,
          customer: { deletedAt: null },
        }),
      }),
    );
  });

  it("hopper over avtalen når den transaksjonsscoped låsen er opptatt", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ locked: false }]);
    const tx = claimTransaction({ $queryRaw: queryRaw });
    useTransaction(tx);
    mocked.contract.findMany.mockResolvedValue([{ id: "contract-1" }]);

    const results = await generateDueRecurringWorkOrders(now);

    expect(results).toEqual([{ contractId: "contract-1", skipped: "locked" }]);
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.workOrder.create).not.toHaveBeenCalled();
    // Låsen ble aldri tatt. Det finnes ingen sesjonslås å frigjøre.
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(rawSql(queryRaw)).toContain("pg_try_advisory_xact_lock");
  });

  it("frigjør låsen automatisk (ingen pg_advisory_unlock) etter kjøringen", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ locked: true }]);
    const tx = claimTransaction({ $queryRaw: queryRaw });
    useTransaction(tx);
    mocked.contract.findMany.mockResolvedValue([{ id: "contract-1" }]);

    const results = await generateDueRecurringWorkOrders(now);

    expect(results).toEqual([
      expect.objectContaining({ contractId: "contract-1", workOrderId: "wo-new" }),
    ]);
    // Bare låsekallet – opplåsing skjer implisitt ved commit.
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(rawSql(queryRaw)).not.toContain("pg_advisory_unlock");
  });

  it("blokkerer trygt når transaksjonen feiler, uten å frigjøre manuelt", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ locked: true }]);
    const tx = claimTransaction({
      $queryRaw: queryRaw,
      workOrder: {
        create: vi.fn().mockRejectedValue(new Error("databasen feilet")),
      },
    });
    useTransaction(tx);
    mocked.contract.findMany.mockResolvedValue([{ id: "contract-1" }]);

    const results = await generateDueRecurringWorkOrders(now);

    expect(results).toEqual([
      {
        contractId: "contract-1",
        skipped: "error",
        error: "databasen feilet",
      },
    ]);
    // Feilen ruller tilbake transaksjonen. Låsen forsvinner med den, og vi
    // skal aldri kalle pg_advisory_unlock på en sesjonslås.
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(rawSql(queryRaw)).not.toContain("pg_advisory_unlock");
  });
});

describe("generateRecurringWorkOrderForContract", () => {
  it("oppretter oppdraget når avtalen er forfalt", async () => {
    const tx = claimTransaction();
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

  it("bruker pg_try_advisory_xact_lock, ikke den sesjonsscoped varianten", async () => {
    const tx = claimTransaction();
    useTransaction(tx);

    await generateRecurringWorkOrderForContract("contract-1", now);

    const sql = rawSql(tx.$queryRaw);
    expect(sql).toContain("pg_try_advisory_xact_lock");
    expect(sql).not.toContain("pg_try_advisory_lock");
    expect(sql).not.toContain("pg_advisory_unlock");
  });

  it("holder krav-transaksjonen kort og avgrenset", async () => {
    const tx = claimTransaction();
    useTransaction(tx);

    await generateRecurringWorkOrderForContract("contract-1", now);

    expect(mocked.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxWait: expect.any(Number),
        timeout: expect.any(Number),
      }),
    );
    const options = mocked.$transaction.mock.calls[0][1] as {
      maxWait: number;
      timeout: number;
    };
    expect(options.timeout).toBeLessThanOrEqual(60_000);
    expect(options.maxWait).toBeLessThanOrEqual(10_000);
  });

  it("behandler unikhetskollisjon som «allerede generert»", async () => {
    mocked.$transaction.mockRejectedValue({ code: "P2002" });

    const result = await generateRecurringWorkOrderForContract("contract-1", now);

    expect(result).toEqual({
      contractId: "contract-1",
      skipped: "already-generated",
    });
  });

  it("lar andre transaksjonsfeil boble opp og frigjør låsen via rollback", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ locked: true }]);
    const tx = claimTransaction({
      $queryRaw: queryRaw,
      workOrder: {
        create: vi.fn().mockRejectedValue(new Error("databasen feilet")),
      },
    });
    useTransaction(tx);

    await expect(
      generateRecurringWorkOrderForContract("contract-1", now),
    ).rejects.toThrow("databasen feilet");

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(rawSql(queryRaw)).not.toContain("pg_advisory_unlock");
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

    useTransaction(claimTransaction());

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

  it("ekskluderer slettede oppdrag og rapporter fra forrige rapport-oppslag", async () => {
    const tx = claimTransaction();
    useTransaction(tx);

    await generateRecurringWorkOrderForContract("contract-1", now);

    expect(mocked.workOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractId: "contract-1",
          deletedAt: null,
          reports: { some: { deletedAt: null } },
        }),
      }),
    );
  });

  it("beholder oppdraget når vedlegget ikke kan lages", async () => {
    mocked.workOrder.findFirst.mockResolvedValue({
      id: "wo-previous",
      scheduledFor: new Date("2025-01-01T00:00:00.000Z"),
    });
    mockedPdfStore.mockRejectedValue(new Error("PDF feilet"));

    useTransaction(claimTransaction());

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

  it("hopper over avtaler for mykt slettede kunder", async () => {
    mocked.contract.findUnique.mockResolvedValue(
      contract({
        customer: { contacts: [], deletedAt: new Date("2026-05-01T00:00:00Z") },
      }),
    );

    const result = await generateRecurringWorkOrderForContract("contract-1", now);

    expect(result).toEqual({
      contractId: "contract-1",
      skipped: "customer-deleted",
    });
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});
