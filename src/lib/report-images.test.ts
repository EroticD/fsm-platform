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
  resolvePdfImageSource,
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

describe("resolvePdfImageSource – feiler lukket", () => {
  const upload = "/uploads/11111111-1111-4111-8111-111111111111.png";

  it("bruker et ferdig innbakt bilde når det finnes", () => {
    const embedded = { src: "data:image/jpeg;base64,abc", width: 100, height: 50 };
    expect(
      resolvePdfImageSource(upload, { [upload]: embedded }, "https://fsm.example"),
    ).toEqual(embedded);
  });

  it("gjør en lokal opplasting absolutt mot appens egen adresse", () => {
    expect(
      resolvePdfImageSource(upload, {}, "https://fsm.example/"),
    ).toEqual({ src: `https://fsm.example${upload}` });
  });

  it("avviser eksterne http(s)-adresser", () => {
    expect(
      resolvePdfImageSource(
        "https://intern.tjeneste/hemmelig.png",
        {},
        "https://fsm.example",
      ),
    ).toBeNull();
    expect(
      resolvePdfImageSource(
        "http://169.254.169.254/latest/meta-data",
        {},
        "https://fsm.example",
      ),
    ).toBeNull();
  });

  it("avviser lokale stier uten kjent base-URL og andre stier", () => {
    expect(resolvePdfImageSource(upload, {}, null)).toBeNull();
    expect(
      resolvePdfImageSource("/uploads/../hemmelig.png", {}, "https://fsm.example"),
    ).toBeNull();
    expect(
      resolvePdfImageSource("//evil.example/x.png", {}, "https://fsm.example"),
    ).toBeNull();
  });

  it("godtar bare data-URL-er med bildeformat", () => {
    expect(
      resolvePdfImageSource("data:image/png;base64,abc", {}, null),
    ).toEqual({ src: "data:image/png;base64,abc" });
    expect(
      resolvePdfImageSource("data:text/html;base64,abc", {}, null),
    ).toBeNull();
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
        ownerId: "wo1",
        departmentId: "dep-a",
        customerId: null,
        uploadedById: "tekniker",
      },
    ]);

    const images = await buildPdfImages([
      {
        url: reportImage,
        ownerTypes: REPORT_IMAGE_OWNER_TYPES,
        workOrder: { id: "wo1", departmentId: "dep-a", customerId: null },
      },
    ]);

    expect(mocks.prisma.upload.findMany).toHaveBeenCalledWith({
      where: {
        storedName: {
          in: ["11111111-1111-4111-8111-111111111111.png"],
        },
      },
      select: {
        storedName: true,
        ownerType: true,
        ownerId: true,
        departmentId: true,
        customerId: true,
        uploadedById: true,
      },
    });
    expect(mocks.readFile).toHaveBeenCalledTimes(1);
    expect(images[reportImage]).toMatchObject({
      src: expect.stringMatching(/^data:image\/jpeg;base64,/),
      width: PDF_IMAGE_MAX_WIDTH,
      height: Math.round(50 * (PDF_IMAGE_MAX_WIDTH / 100)),
    });
  });

  it("leser ikke et rapportbilde som eies av et annet oppdrag", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([
      {
        storedName: "11111111-1111-4111-8111-111111111111.png",
        ownerType: "WORK_ORDER",
        ownerId: "annet-oppdrag",
        departmentId: "dep-a",
        customerId: null,
        uploadedById: "tekniker",
      },
    ]);

    const images = await buildPdfImages([
      {
        url: reportImage,
        ownerTypes: REPORT_IMAGE_OWNER_TYPES,
        workOrder: { id: "wo1", departmentId: "dep-a", customerId: null },
      },
    ]);

    expect(images).toEqual({});
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("leser ikke et rapportbilde fra feil avdeling eller kunde", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([
      {
        storedName: "11111111-1111-4111-8111-111111111111.png",
        ownerType: "WORK_ORDER",
        ownerId: "wo1",
        departmentId: "dep-b",
        customerId: "annen-kunde",
        uploadedById: "tekniker",
      },
    ]);

    const images = await buildPdfImages([
      {
        url: reportImage,
        ownerTypes: REPORT_IMAGE_OWNER_TYPES,
        workOrder: { id: "wo1", departmentId: "dep-a", customerId: "kunde-1" },
      },
    ]);

    expect(images).toEqual({});
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("feiler lukket når rapportbildet mangler oppdragskontekst", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([
      {
        storedName: "11111111-1111-4111-8111-111111111111.png",
        ownerType: "WORK_ORDER",
        ownerId: "wo1",
        departmentId: "dep-a",
        customerId: null,
        uploadedById: "tekniker",
      },
    ]);

    const images = await buildPdfImages([
      { url: reportImage, ownerTypes: REPORT_IMAGE_OWNER_TYPES },
    ]);

    expect(images).toEqual({});
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("leser ikke en fil som mangler opplastingsrad", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([]);

    const images = await buildPdfImages([
      {
        url: reportImage,
        ownerTypes: REPORT_IMAGE_OWNER_TYPES,
        workOrder: { id: "wo1", departmentId: "dep-a", customerId: null },
      },
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
