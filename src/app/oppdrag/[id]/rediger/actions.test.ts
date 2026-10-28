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
  updateWorkOrder: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/session";
import { updateWorkOrder as updateWorkOrderService } from "@/server/work-orders";
import { updateWorkOrder } from "./actions";

const user = { id: "u1", name: "Kari", email: "kari@example.com" };

function form() {
  const data = new FormData();
  data.set("workOrderId", "wo1");
  data.set("title", "Service");
  return data;
}

describe("updateWorkOrder (action-wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue(user as never);
  });

  it("viser duplikat ordrenummer i redigeringsskjemaet", async () => {
    vi.mocked(updateWorkOrderService).mockResolvedValue({
      ok: false,
      error: "duplikat-ordrenummer",
    });

    await expect(updateWorkOrder(form())).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo1/rediger?error=duplikat-ordrenummer",
    );
  });

  it("viser ugyldig data i redigeringsskjemaet", async () => {
    vi.mocked(updateWorkOrderService).mockResolvedValue({
      ok: false,
      error: "ugyldig-data",
    });

    await expect(updateWorkOrder(form())).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo1/rediger?error=ugyldig-data",
    );
  });

  it("viser dato-feil i redigeringsskjemaet", async () => {
    vi.mocked(updateWorkOrderService).mockResolvedValue({
      ok: false,
      error: "sluttdato-for-startdato",
    });

    await expect(updateWorkOrder(form())).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo1/rediger?error=sluttdato-for-startdato",
    );
  });

  it("sender låst oppdrag til detaljsiden med forklaring", async () => {
    vi.mocked(updateWorkOrderService).mockResolvedValue({
      ok: false,
      error: "workorder-locked",
    });

    await expect(updateWorkOrder(form())).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo1?error=workorder-locked",
    );
  });

  it("revaliderer og går tilbake etter lagring", async () => {
    vi.mocked(updateWorkOrderService).mockResolvedValue({ ok: true });

    await expect(updateWorkOrder(form())).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/wo1",
    );

    expect(revalidatePath).toHaveBeenCalledWith("/oppdrag/wo1");
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});
