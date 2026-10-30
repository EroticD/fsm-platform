import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  revalidatePath: vi.fn(),
  getCurrentUser: vi.fn(),
  setVisitStatus: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/work-orders", () => ({}));
vi.mock("@/server/visits", () => ({
  setVisitStatus: mocks.setVisitStatus,
}));

import { setVisitStatus } from "./actions";

const technician = {
  id: "tech-1",
  name: "Ola Montør",
  email: "montor@example.test",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dep-1",
};

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(technician);
});

describe("setVisitStatus på feltdetaljen", () => {
  it("kaller tjenesten med montøren og revaliderer listene", async () => {
    mocks.setVisitStatus.mockResolvedValue({
      ok: true,
      data: { id: "visit-1" },
    });

    await expect(
      setVisitStatus(
        form({
          workOrderId: "wo-1",
          visitId: "visit-1",
          status: "ON_SITE",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/mine-oppdrag/wo-1?visitOk=1");

    expect(mocks.setVisitStatus).toHaveBeenCalledWith(
      technician,
      "visit-1",
      "ON_SITE",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/mine-oppdrag/wo-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/mine-oppdrag");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/kart");
  });

  it("videresender en ulovlig overgang som inline feil", async () => {
    mocks.setVisitStatus.mockResolvedValue({
      ok: false,
      reason: "invalid",
      details: {
        code: "visits.errors.statusTransition",
        from: "PLANNED",
        to: "DONE",
      },
    });

    await expect(
      setVisitStatus(
        form({
          workOrderId: "wo-1",
          visitId: "visit-1",
          status: "DONE",
        }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/mine-oppdrag/wo-1?visitError=statusTransition",
    );

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("avviser manglende visitt-id før tjenesten kalles", async () => {
    await expect(
      setVisitStatus(
        form({ workOrderId: "wo-1", status: "ON_SITE" }),
      ),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/mine-oppdrag/wo-1?visitError=invalidInput",
    );

    expect(mocks.setVisitStatus).not.toHaveBeenCalled();
  });

  it("sender uinnlogget bruker til innlogging", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(
      setVisitStatus(
        form({
          workOrderId: "wo-1",
          visitId: "visit-1",
          status: "ON_SITE",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/api/auth/signin");

    expect(mocks.setVisitStatus).not.toHaveBeenCalled();
  });
});
