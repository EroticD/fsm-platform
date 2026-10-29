import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  allowRequestDb: vi.fn(),
  customerFindFirst: vi.fn(),
  workOrderFindMany: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/rate-limit-db", () => ({
  allowRequestDb: mocks.allowRequestDb,
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    customer: { findFirst: mocks.customerFindFirst },
    workOrder: { findMany: mocks.workOrderFindMany },
  },
}));

import { GET } from "./route";

const workOrder = {
  title: "Service",
  status: "COMPLETED",
  scheduledFor: new Date("2026-10-01"),
  scheduledTo: null,
  creatorName: "Kari",
  contact: { name: "Ola" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({
    id: "u1",
    isActive: true,
    role: "CUSTOMER",
    customerId: "c1",
  });
  mocks.customerFindFirst.mockResolvedValue({ id: "c1" });
  mocks.allowRequestDb.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
  });
  mocks.workOrderFindMany.mockResolvedValue([workOrder]);
});

describe("GET /api/kundeportal/export", () => {
  it("rate-limiter per bruker", async () => {
    mocks.allowRequestDb.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 120,
    });

    const response = await GET();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(mocks.workOrderFindMany).not.toHaveBeenCalled();
  });

  it("begrenser antall rader", async () => {
    mocks.workOrderFindMany.mockResolvedValue(
      Array.from({ length: 5001 }, () => workOrder),
    );

    const response = await GET();

    expect(response.status).toBe(413);
    expect(mocks.workOrderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5001 }),
    );
  });

  it("beholder kolonnene i CSV-eksporten", async () => {
    const response = await GET();
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(csv).toContain(
      '"Tittel";"Status";"Fra dato";"Til dato";"Booket av";"Kontaktperson"',
    );
    expect(csv).toContain('"Service";"COMPLETED";"2026-10-01"');
  });
});
