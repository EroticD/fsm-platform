import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createSavedSearch: vi.fn(),
  deleteSavedSearch: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/server/saved-searches", () => ({
  createSavedSearch: mocks.createSavedSearch,
  deleteSavedSearch: mocks.deleteSavedSearch,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

import { deleteSearchAction, saveSearchAction } from "./actions";
import { searchFiltersFromFormData } from "./saved-search-form";

const user = {
  id: "u1",
  name: "Kari",
  email: "kari@example.test",
  role: "OFFICE",
  isActive: true,
  departmentId: "dep-a",
};

function formData(entries: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      value.forEach((item) => data.append(key, item));
    } else {
      data.append(key, value);
    }
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(user);
  mocks.createSavedSearch.mockResolvedValue({ ok: true, data: {} });
  mocks.deleteSavedSearch.mockResolvedValue({ ok: true, data: undefined });
});

describe("searchFiltersFromFormData", () => {
  it("leser og validerer filterfeltene fra skjemaet", () => {
    expect(
      searchFiltersFromFormData(
        formData({
          types: ["workOrder", "report", "ukjent"],
          status: "completed",
          customer: "cust-1",
          technician: "user_1",
          dateFrom: "2026-04-01",
          dateTo: "ugyldig",
          tag: " HMS ",
          hmsType: "sja",
        }),
      ),
    ).toEqual({
      types: ["workOrder", "report"],
      status: "COMPLETED",
      customer: "cust-1",
      technician: "user_1",
      dateFrom: "2026-04-01",
      tag: "HMS",
      hmsType: "SJA",
    });
  });
});

describe("saveSearchAction", () => {
  it("lagrer navn, q og filtre og redirecter tilbake til søket", async () => {
    await expect(
      saveSearchAction(
        formData({
          name: "  HMS pumpe ",
          q: "pumpe",
          page: "2",
          types: "report",
          status: "COMPLETED",
        }),
      ),
    ).rejects.toThrow(
      "redirect:/sok?q=pumpe&page=2&types=report&status=COMPLETED&lagre=lagret",
    );

    expect(mocks.createSavedSearch).toHaveBeenCalledWith(user, {
      name: "  HMS pumpe ",
      query: "pumpe",
      filters: { types: ["report"], status: "COMPLETED" },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/sok");
  });

  it("gir duplikatmelding uten å kaste bort søket", async () => {
    mocks.createSavedSearch.mockResolvedValue({ ok: false, reason: "conflict" });

    await expect(
      saveSearchAction(formData({ name: "Pumpe", q: "pumpe", status: "OPEN" })),
    ).rejects.toThrow("redirect:/sok?q=pumpe&status=OPEN&lagre=duplikat");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("gir feilmelding hvis tjenesten kaster", async () => {
    mocks.createSavedSearch.mockRejectedValue(new Error("db nede"));

    await expect(
      saveSearchAction(formData({ name: "Pumpe", q: "pumpe" })),
    ).rejects.toThrow("redirect:/sok?q=pumpe&lagre=feil");
  });

  it("redirecter til innlogging uten aktiv bruker", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(saveSearchAction(formData({ name: "Pumpe", q: "pumpe" }))).rejects.toThrow(
      "redirect:/api/auth/signin",
    );
    expect(mocks.createSavedSearch).not.toHaveBeenCalled();
  });
});

describe("deleteSearchAction", () => {
  it("sletter eget søk og bevarer gjeldende søk", async () => {
    await expect(
      deleteSearchAction(
        formData({ id: "saved-1", q: "pumpe", page: "3", tag: "HMS" }),
      ),
    ).rejects.toThrow("redirect:/sok?q=pumpe&page=3&tag=HMS&slettet=ok");

    expect(mocks.deleteSavedSearch).toHaveBeenCalledWith(user, "saved-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/sok");
  });

  it("gir feilmelding når sletting ikke er tillatt", async () => {
    mocks.deleteSavedSearch.mockResolvedValue({ ok: false, reason: "not_found" });
    await expect(
      deleteSearchAction(formData({ id: "saved-2", q: "pumpe" })),
    ).rejects.toThrow("redirect:/sok?q=pumpe&slettet=feil");
  });
});
