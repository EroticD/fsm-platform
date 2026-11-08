import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireModulePage: vi.fn(async () => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/module-guards", () => ({
  requireModulePage: mocks.requireModulePage,
}));

import QuotesPage from "./tilbud/page";
import InvoicesPage from "./faktura/page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("modulvakt på nye sider", () => {
  it("gir 404 for /tilbud når quotes-modulen er av", async () => {
    await expect(
      QuotesPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireModulePage).toHaveBeenCalledWith("quotes");
  });

  it("gir 404 for /faktura når invoicing-modulen er av", async () => {
    await expect(
      InvoicesPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireModulePage).toHaveBeenCalledWith("invoicing");
  });
});
