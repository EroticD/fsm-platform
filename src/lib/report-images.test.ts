import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { upload: { findMany: vi.fn(), findUnique: vi.fn() } },
  readFile: vi.fn(),
  sharp: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("node:fs/promises", () => ({ default: { readFile: mocks.readFile } }));
vi.mock("sharp", () => ({ default: mocks.sharp }));

import {
  buildPdfImages,
  collectReportImageUrls,
  PDF_IMAGE_MAX_WIDTH,
} from "./report-images";
import {
  BRANDING_LOGO_OWNER_TYPES,
  REPORT_IMAGE_OWNER_TYPES,
} from "./upload-ownership";

/** En enkel etterlikning av sharp-kjeden, med et 100×50-bilde. */
function sharpStub() {
  const chain = {
    rotate: () => chain,
    resize: () => chain,
    flatten: () => chain,
    jpeg: () => chain,
    toBuffer: async () => ({
      data: Buffer.from("bilde"),
      info: { width: 100, height: 50 },
    }),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.upload.findMany.mockResolvedValue([]);
  mocks.readFile.mockResolvedValue(Buffer.from("original"));
  mocks.sharp.mockReturnValue(sharpStub());
});

describe("collectReportImageUrls", () => {
  it("tar med signaturbilder slik at PDF-en kan bygge dem inn", () => {
    const urls = collectReportImageUrls([
      {
        dataJson: JSON.stringify({ answers: {} }),
        technicianSignatureUrl: "/uploads/tekniker.png",
        customerSignatureUrl: "/uploads/kunde.jpg",
        units: [],
      },
    ]);

    expect(urls).toEqual([
      "/uploads/tekniker.png",
      "/uploads/kunde.jpg",
    ]);
  });

  it("dedupliserer signaturer og vanlige vedlegg", () => {
    const urls = collectReportImageUrls([
      {
        dataJson: JSON.stringify({
          answers: { f1: "/uploads/tekniker.png" },
        }),
        technicianSignatureUrl: "/uploads/tekniker.png",
        units: [],
      },
    ]);

    expect(urls).toEqual(["/uploads/tekniker.png"]);
  });
});

describe("buildPdfImages – eierskap", () => {
  const reportImage = "/uploads/11111111-1111-4111-8111-111111111111.png";
  const logo = "/uploads/22222222-2222-4222-8222-222222222222.png";

  it("lar et rapportbilde med WORK_ORDER-eier bli skalert", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([
      {
        storedName: "11111111-1111-4111-8111-111111111111.png",
        ownerType: "WORK_ORDER",
        uploadedById: "tekniker",
      },
    ]);

    const images = await buildPdfImages([
      { url: reportImage, ownerTypes: REPORT_IMAGE_OWNER_TYPES },
    ]);

    expect(mocks.prisma.upload.findMany).toHaveBeenCalledWith({
      where: {
        storedName: {
          in: ["11111111-1111-4111-8111-111111111111.png"],
        },
      },
      select: { storedName: true, ownerType: true, uploadedById: true },
    });
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
    expect(images[reportImage]).toMatchObject({
      src: expect.stringMatching(/^data:image\/jpeg;base64,/),
      width: PDF_IMAGE_MAX_WIDTH,
      height: Math.round(50 * (PDF_IMAGE_MAX_WIDTH / 100)),
    });
  });

  it("leser ikke en fil som mangler opplastingsrad", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([]);

    const images = await buildPdfImages([
      { url: reportImage, ownerTypes: REPORT_IMAGE_OWNER_TYPES },
    ]);

    expect(images).toEqual({});
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.sharp).not.toHaveBeenCalled();
  });

  it("leser ikke et rapportbilde som eies av en annen eiertype", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([
      {
        storedName: "11111111-1111-4111-8111-111111111111.png",
        ownerType: "USER",
        uploadedById: "noen",
      },
    ]);

    const images = await buildPdfImages([
      { url: reportImage, ownerTypes: REPORT_IMAGE_OWNER_TYPES },
    ]);

    expect(images).toEqual({});
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("lar en merkevarelogo med BRANDING-eier bli skalert", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([
      {
        storedName: "22222222-2222-4222-8222-222222222222.png",
        ownerType: "BRANDING",
        uploadedById: "admin",
      },
    ]);

    const images = await buildPdfImages([
      { url: logo, ownerTypes: BRANDING_LOGO_OWNER_TYPES },
    ]);

    expect(images[logo]).toBeDefined();
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
  });

  it("behandler en merkevarelogo som er lastet opp som oppdragsfil som ugyldig", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([
      {
        storedName: "22222222-2222-4222-8222-222222222222.png",
        ownerType: "WORK_ORDER",
        uploadedById: "admin",
      },
    ]);

    const images = await buildPdfImages([
      { url: logo, ownerTypes: BRANDING_LOGO_OWNER_TYPES },
    ]);

    expect(images).toEqual({});
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});
