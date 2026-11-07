import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: vi.fn(),
}));
vi.mock("@/lib/module-guards", () => ({
  requireModulePage: async () => mocks.notFound(),
}));

import InventoryPage from "./page";

describe("/lager", () => {
  it("gir 404 når inventory-modulen er av", async () => {
    await expect(
      InventoryPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });
});
