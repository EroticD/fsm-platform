import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  exportAuditArchive: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/audit-export", () => ({
  exportAuditArchive: mocks.exportAuditArchive,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exportAuditArchive.mockResolvedValue({
    ok: true,
    data: {
      buffer: Buffer.from("PK"),
      manifest: { version: 1, kind: "audit-log", files: [], missing: [] },
      fileName: "revisjonslogg-1.zip",
    },
  });
});

describe("revisjonslogg-eksportruten", () => {
  it("gir 403 til ikke-administrator", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "office",
      role: "OFFICE",
      isActive: true,
    });

    const response = await GET(
      new Request("http://localhost/api/innstillinger/audit/eksport"),
    );

    expect(response.status).toBe(403);
    expect(mocks.exportAuditArchive).not.toHaveBeenCalled();
  });

  it("sender filtre videre og returnerer ZIP", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "admin",
      role: "ADMIN",
      isActive: true,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/innstillinger/audit/eksport?fra=2026-01-01&til=2026-01-31&avdeling=dep-1",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(mocks.exportAuditArchive).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin" }),
      expect.objectContaining({
        departmentId: "dep-1",
        dateFrom: new Date("2026-01-01T00:00:00.000Z"),
        dateTo: new Date("2026-01-31T23:59:59.999Z"),
      }),
    );
  });
});
