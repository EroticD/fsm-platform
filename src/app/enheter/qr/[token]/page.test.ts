import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((): never => {
    throw new Error("REDIRECT");
  }),
  resolveEquipmentQrToken: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));
vi.mock("@/server/equipment", () => ({
  resolveEquipmentQrToken: mocks.resolveEquipmentQrToken,
}));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));

import EquipmentQrPage from "./page";

const params = (token: string) => ({ params: Promise.resolve({ token }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/enheter/qr/[token]", () => {
  it("gir 404 når den gamle etiketten er rotert bort", async () => {
    mocks.resolveEquipmentQrToken.mockResolvedValue(null);

    await expect(
      EquipmentQrPage(params("gammel-token-som-ikke-finnes")),
    ).rejects.toThrow("NOT_FOUND");
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  it("sender innloggede brukere til enheten", async () => {
    mocks.resolveEquipmentQrToken.mockResolvedValue({
      id: "product-1",
      model: "Pumpe",
    });
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-1",
      role: "ADMIN",
      isActive: true,
    });

    await expect(
      EquipmentQrPage(params("abcdefghijklmnopqrstuvwx")),
    ).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/enheter/product-1");
  });
});
