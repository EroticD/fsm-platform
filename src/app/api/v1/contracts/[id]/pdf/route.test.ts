import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getContractPdf: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock("@/server/contracts", () => ({
  getContractPdf: mocks.getContractPdf,
}));

import { GET } from "./route";

function actor(): ServiceActor {
  return {
    id: "u1",
    name: "Kari",
    email: "kari@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: "dep-a",
    roleDefinition: { permissions: ["contracts.view"] },
  } as ServiceActor;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true as const,
    actor: actor(),
    apiKeyId: "key-1",
  });
  mocks.getContractPdf.mockResolvedValue({
    ok: true,
    buffer: Buffer.from("%PDF-1.4"),
    fileName: "Avtale-A-100.pdf",
  });
});

describe("GET /api/v1/contracts/[id]/pdf", () => {
  it("returnerer PDF med vedleggsdisposisjon", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/contracts/c1/pdf?locale=en"),
      { params: Promise.resolve({ id: "c1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(
      "Avtale-A-100.pdf",
    );
    expect(mocks.getContractPdf).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1" }),
      "c1",
      "en",
    );
  });

  it("gir 404 når avtalen ikke finnes", async () => {
    mocks.getContractPdf.mockResolvedValue({
      ok: false,
      status: 404,
      message: "Fant ikke avtalen",
    });

    const response = await GET(
      new Request("http://localhost/api/v1/contracts/c1/pdf"),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(response.status).toBe(404);
  });
});
