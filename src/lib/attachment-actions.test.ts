import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    attachment: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn() },
    workOrder: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  claimUpload: vi.fn(),
  audit: vi.fn(),
  requireWorkOrderAccess: vi.fn(),
  getCurrentUser: vi.fn(),
  requireAdmin: vi.fn(),
  releaseUpload: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/upload-access", () => ({ claimUpload: mocks.claimUpload }));
vi.mock("@/lib/upload-cleanup", () => ({ releaseUpload: mocks.releaseUpload }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/access", () => ({
  requireWorkOrderAccess: mocks.requireWorkOrderAccess,
}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/lib/uploads", () => ({ uploadDir: () => "/tmp/opplastinger" }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/customers", () => ({
  addCustomerAttachment: vi.fn(),
  removeCustomerAttachment: vi.fn(),
}));
vi.mock("fs/promises", () => ({
  default: { access: vi.fn(async () => undefined) },
}));

import { addAttachment, removeAttachment } from "./attachment-actions";

const access = {
  user: {
    id: "u1",
    name: "Bruker",
    email: "u1@example.com",
  },
  workOrder: {
    id: "wo1",
    departmentId: "dep-a",
    customerId: "cust-1",
    status: "OPEN",
  },
};

function formData(fileUrl = "/uploads/fil.pdf") {
  const data = new FormData();
  data.set("workOrderId", "wo1");
  data.set("fileUrl", fileUrl);
  data.set("fileName", "fil.pdf");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkOrderAccess.mockResolvedValue(access);
  mocks.prisma.attachment.findFirst.mockResolvedValue(null);
  mocks.prisma.attachment.create.mockResolvedValue({ id: "att-1" });
  mocks.audit.mockResolvedValue(undefined);
  mocks.claimUpload.mockResolvedValue({ claimed: true });
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
});

describe("addAttachment – eierskap", () => {
  it("oppretter ikke vedlegg og gir generisk feil når filen ikke kan kreves", async () => {
    mocks.claimUpload.mockResolvedValue({ claimed: false });

    const result = await addAttachment(formData());

    expect(result).toEqual({ ok: false, error: "Ugyldig fil" });
    expect(mocks.prisma.attachment.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("krever filen i samme transaksjon før vedlegget opprettes", async () => {
    const result = await addAttachment(formData());

    expect(result).toEqual({ ok: true });
    expect(mocks.claimUpload).toHaveBeenCalledWith(
      mocks.prisma,
      "/uploads/fil.pdf",
      "u1",
      {
        ownerType: "WORK_ORDER",
        ownerId: "wo1",
        departmentId: "dep-a",
        customerId: "cust-1",
      },
    );
    expect(mocks.claimUpload.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.attachment.create.mock.invocationCallOrder[0],
    );
    expect(mocks.prisma.attachment.create).toHaveBeenCalledWith({
      data: {
        workOrderId: "wo1",
        fileName: "fil.pdf",
        dataUrl: "/uploads/fil.pdf",
      },
    });
    expect(mocks.audit).toHaveBeenCalled();
  });
});

describe("removeAttachment – bevaringsplikt", () => {
  function removeForm() {
    const data = new FormData();
    data.set("attachmentId", "att-1");
    return data;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue(true);
    mocks.getCurrentUser.mockResolvedValue({
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
    });
    mocks.prisma.attachment.findUnique.mockResolvedValue({
      id: "att-1",
      workOrderId: "wo1",
      fileName: "fil.pdf",
      dataUrl: "/uploads/fil.pdf",
    });
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      legalHold: false,
      reports: [{ legalHold: false }],
    });
    mocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof mocks.prisma) => unknown) =>
        callback(mocks.prisma),
    );
  });

  it("avviser sletting når oppdraget har bevaringsplikt", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      legalHold: true,
      reports: [],
    });

    const result = await removeAttachment(removeForm());

    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("bevaringsplikt");
    expect(mocks.prisma.attachment.delete).not.toHaveBeenCalled();
  });

  it("avviser sletting når en rapport har bevaringsplikt", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      legalHold: false,
      reports: [{ legalHold: true }],
    });

    const result = await removeAttachment(removeForm());

    expect(result.ok).toBe(false);
    expect(mocks.prisma.attachment.delete).not.toHaveBeenCalled();
  });
});
