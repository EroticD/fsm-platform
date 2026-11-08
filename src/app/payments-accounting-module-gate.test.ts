import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireModulePage: vi.fn(async () => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/module-guards", () => ({
  requireModulePage: mocks.requireModulePage,
}));

import PortalInvoiceDetailPage from "./kundeportal/faktura/[id]/page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("modulvakt for betaling og regnskap", () => {
  it("gir 404 i kundeportalen når invoicing er av", async () => {
    await expect(
      PortalInvoiceDetailPage({ params: Promise.resolve({ id: "inv-1" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireModulePage).toHaveBeenCalledWith("invoicing");
  });
});
