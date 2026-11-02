import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  exportEvidenceArchive: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/evidence-export", () => ({
  exportEvidenceArchive: mocks.exportEvidenceArchive,
}));

import { GET } from "./route";

function request(oppdrag = "wo-1") {
  return new Request(
    `http://localhost/api/innstillinger/bevis/export?oppdrag=${encodeURIComponent(oppdrag)}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exportEvidenceArchive.mockResolvedValue({
    ok: true,
    data: {
      buffer: Buffer.from("PK"),
      manifest: { version: 1, kind: "work-order-evidence", files: [], missing: [] },
      fileName: "bevis-1.zip",
    },
  });
});

describe("bevis-eksportruten", () => {
  it("gir 403 til en innlogget ikke-administrator", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "office",
      role: "OFFICE",
      isActive: true,
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mocks.exportEvidenceArchive).not.toHaveBeenCalled();
  });

  it("gir 403 når økten mangler", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(403);
  });

  it("gir 400 uten oppdrags-id", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "admin",
      role: "ADMIN",
      isActive: true,
    });

    const response = await GET(
      new Request("http://localhost/api/innstillinger/bevis/export"),
    );

    expect(response.status).toBe(400);
  });

  it("returnerer ZIP for administrator", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "admin",
      role: "ADMIN",
      isActive: true,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.exportEvidenceArchive).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin" }),
      "wo-1",
    );
  });
});
