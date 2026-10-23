import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/access", () => ({
  requireWorkOrderAccess: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    workOrder: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    auditLog: { create: vi.fn() },
  },
}));

import { requireWorkOrderAccess } from "@/lib/access";
import prisma from "@/lib/prisma";
import { deleteWorkOrder } from "./actions";

const mockedAccess = vi.mocked(requireWorkOrderAccess);

function form(workOrderId: string) {
  const data = new FormData();
  data.set("workOrderId", workOrderId);
  return data;
}

describe("deleteWorkOrder", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sletter ikke et oppdrag brukeren ikke har tilgang til", async () => {
    mockedAccess.mockResolvedValue(null);

    await deleteWorkOrder(form("wo-i-annen-avdeling"));

    expect(prisma.workOrder.delete).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("sletter oppdraget når avdelingskontrollen slipper gjennom", async () => {
    mockedAccess.mockResolvedValue({
      user: { id: "u1", name: "Kari", email: "kari@example.com" },
      workOrder: {
        id: "wo-a",
        departmentId: "dept-a",
        customerId: null,
        status: "OPEN",
      },
    } as never);
    vi.mocked(prisma.workOrder.findUnique).mockResolvedValue({
      title: "Testoppdrag",
      customer: null,
    } as never);

    await expect(deleteWorkOrder(form("wo-a"))).rejects.toThrow("NEXT_REDIRECT");

    expect(prisma.workOrder.delete).toHaveBeenCalledWith({ where: { id: "wo-a" } });
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });
});
