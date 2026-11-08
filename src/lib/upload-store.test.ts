import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    upload: {
      findFirst: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  },
  stat: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/uploads", () => ({
  uploadDir: () => "/tmp/uploads",
  statUploadFile: mocks.stat,
  writeUploadFile: mocks.write,
  deleteUploadFile: mocks.remove,
}));

import { MAX_USER_SIGNATURE_UPLOADS, storeDataImage } from "./upload-store";

const DATA_URL = "data:image/png;base64,AAAA";

function userContext() {
  return {
    ownerType: "USER" as const,
    ownerId: "u1",
    departmentId: "dep-a",
    customerId: null,
    uploadedById: "u1",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.upload.findFirst.mockResolvedValue(null);
  mocks.prisma.upload.count.mockResolvedValue(0);
  mocks.prisma.upload.aggregate.mockResolvedValue({ _sum: { size: 0 } });
  mocks.prisma.upload.deleteMany.mockResolvedValue({ count: 0 });
  mocks.prisma.upload.create.mockResolvedValue({});
  mocks.stat.mockResolvedValue({ key: "finnes.png", size: 4 });
  mocks.write.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
});

describe("storeDataImage – kladdesignaturer", () => {
  it("gjenbruker en identisk signatur som allerede eies av brukeren", async () => {
    mocks.prisma.upload.findFirst.mockResolvedValue({ storedName: "finnes.png" });

    await expect(storeDataImage(DATA_URL, userContext())).resolves.toBe(
      "/uploads/finnes.png",
    );
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.prisma.upload.create).not.toHaveBeenCalled();
  });

  it("rydder borte metadata og lager ny fil når den gamle mangler", async () => {
    mocks.prisma.upload.findFirst.mockResolvedValue({ storedName: "borte.png" });
    mocks.stat.mockResolvedValueOnce(null);

    await expect(storeDataImage(DATA_URL, userContext())).resolves.toMatch(
      /^\/uploads\/.+\.png$/,
    );
    expect(mocks.prisma.upload.deleteMany).toHaveBeenCalledWith({
      where: { storedName: "borte.png" },
    });
    expect(mocks.prisma.upload.create).toHaveBeenCalled();
  });

  it("avviser når brukeren har for mange levende kladdesignaturer", async () => {
    mocks.prisma.upload.count.mockResolvedValue(MAX_USER_SIGNATURE_UPLOADS);

    await expect(storeDataImage(DATA_URL, userContext())).rejects.toThrow(
      "For mange lagrede kladdesignaturer",
    );
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("avviser når daglig kvote er brukt opp", async () => {
    mocks.prisma.upload.aggregate.mockResolvedValue({
      _sum: { size: 2 * 1024 * 1024 * 1024 },
    });

    await expect(storeDataImage(DATA_URL, userContext())).rejects.toThrow(
      "Daglig lagringskvote",
    );
  });
});
