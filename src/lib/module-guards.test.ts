import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  moduleEnabled: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/server/modules", () => ({ moduleEnabled: mocks.moduleEnabled }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import { moduleApiGuard, requireModulePage } from "./module-guards";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("direkte URL og modulvakt", () => {
  it("kaller notFound når modulen er av", async () => {
    mocks.moduleEnabled.mockResolvedValue(false);
    await expect(requireModulePage("documents")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });

  it("slipper gjennom når modulen er på", async () => {
    mocks.moduleEnabled.mockResolvedValue(true);
    await expect(requireModulePage("documents")).resolves.toBeUndefined();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("gir 404-respons for API-ruter når modulen er av", async () => {
    mocks.moduleEnabled.mockResolvedValue(false);
    const response = await moduleApiGuard("reports");
    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toMatchObject({
      error: "not_found",
    });
  });
});
