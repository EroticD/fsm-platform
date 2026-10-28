import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock("@/lib/session", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/server/work-orders", () => ({
  createWorkOrder: vi.fn(),
}));

import { getCurrentUser } from "@/lib/session";
import { createWorkOrder as createWorkOrderService } from "@/server/work-orders";
import { createWorkOrder } from "./actions";

const user = { id: "u1", name: "Kari", email: "kari@example.com" };

function form() {
  const data = new FormData();
  data.set("title", "Service");
  data.set("scheduledFor", "2026-10-28");
  return data;
}

describe("createWorkOrder (action-wrapper)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue(user as never);
  });

  it("sender duplikat ordrenummer tilbake til skjemaet med synlig feilkode", async () => {
    vi.mocked(createWorkOrderService).mockResolvedValue({
      ok: false,
      error: "duplikat-ordrenummer",
    });

    await expect(createWorkOrder(form())).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/ny?error=duplikat-ordrenummer",
    );
  });

  it("sender avdelingsfeil tilbake til skjemaet", async () => {
    vi.mocked(createWorkOrderService).mockResolvedValue({
      ok: false,
      error: "avdeling",
    });

    await expect(createWorkOrder(form())).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/ny?error=avdeling",
    );
  });

  it("sender ugyldig data tilbake til skjemaet", async () => {
    vi.mocked(createWorkOrderService).mockResolvedValue({
      ok: false,
      error: "ugyldig-data",
    });

    await expect(createWorkOrder(form())).rejects.toThrow(
      "NEXT_REDIRECT:/oppdrag/ny?error=ugyldig-data",
    );
  });

  it("går til kalenderen etter en vellykket opprettelse", async () => {
    vi.mocked(createWorkOrderService).mockResolvedValue({
      ok: true,
      id: "wo1",
    });

    await expect(createWorkOrder(form())).rejects.toThrow(
      "NEXT_REDIRECT:/kalender",
    );
  });
});
