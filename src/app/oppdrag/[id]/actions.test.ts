import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/server/work-orders", () => ({
  deleteWorkOrder: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { deleteWorkOrder as deleteWorkOrderService } from "@/server/work-orders";
import { deleteWorkOrder } from "./actions";

const user = { id: "u1", name: "Kari", email: "kari@example.com" };

function form(workOrderId: string) {
  const data = new FormData();
  data.set("workOrderId", workOrderId);
  return data;
}

describe("deleteWorkOrder (action-wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue(user as never);
  });

  it("videresender tjenestens avvisning uten å revalidere", async () => {
    vi.mocked(deleteWorkOrderService).mockResolvedValue({
      ok: false,
      error: "ikke-tilgang",
    });

    await expect(deleteWorkOrder(form("wo-i-annen-avdeling"))).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag?error=ikke-tilgang",
    );

    expect(deleteWorkOrderService).toHaveBeenCalledWith(
      user,
      "wo-i-annen-avdeling",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sletter via tjenesten og revaliderer listene", async () => {
    vi.mocked(deleteWorkOrderService).mockResolvedValue({ ok: true });

    await expect(deleteWorkOrder(form("wo-a"))).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag",
    );

    expect(deleteWorkOrderService).toHaveBeenCalledWith(user, "wo-a");
    expect(revalidatePath).toHaveBeenCalledWith("/oppdrag");
    expect(revalidatePath).toHaveBeenCalledWith("/rapporter");
  });

  it("avviser en tom id før tjenesten kalles", async () => {
    await expect(deleteWorkOrder(form(""))).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag?error=ugyldig-data",
    );

    expect(deleteWorkOrderService).not.toHaveBeenCalled();
  });
});
