import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: { findUnique: vi.fn(), findMany: vi.fn() },
    upload: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  readFile: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("@/lib/uploads", () => ({ uploadDir: () => "/tmp/evidence" }));
vi.mock("node:fs/promises", () => ({
  default: { readFile: mocks.readFile },
  readFile: mocks.readFile,
}));

import { auditHashesForRow } from "@/lib/audit-chain";
import { createZip, readZip } from "@/lib/zip";
import {
  exportEvidenceArchive,
  storedNameFromUploadUrl,
  verifyEvidenceArchive,
} from "./evidence-export";

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "admin",
    name: "Admin",
    email: "admin@example.test",
    role: "ADMIN",
    isActive: true,
    departmentId: "dep-1",
    ...overrides,
  };
}

function auditRow() {
  const fields = {
    entityType: "WorkOrder",
    entityId: "wo-1",
    action: "Opprettet oppdrag",
    userName: "Admin",
    actorId: "admin",
    departmentId: "dep-1",
    metadata: { reportId: "r1" },
    createdAt: new Date("2026-11-01T10:00:00.000Z"),
  };
  return {
    id: "log-1",
    seq: 1,
    ...fields,
    ...auditHashesForRow(fields, null),
  };
}

function workOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "wo-1",
    title: "Service",
    reference: "O-261101-ABC",
    departmentId: "dep-1",
    department: { id: "dep-1", name: "Oslo" },
    customer: {
      id: "cust-1",
      name: "Kunde AS",
      email: "kunde@example.test",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    contact: { id: "contact-1", name: "Kontakt" },
    attachments: [
      {
        id: "att-1",
        fileName: "bilde.jpg",
        dataUrl: "/uploads/upl-1.jpg",
      },
    ],
    reports: [
      {
        id: "r1",
        name: "Sjekkliste",
        dataJson: "{}",
        technicianSignatureUrl: "/uploads/sig.png",
        customerSignatureUrl: null,
        pdfUrl: null,
        units: [{ id: "unit-1", label: "Pumpe", sortOrder: 1 }],
        revisions: [
          {
            id: "rev-1",
            revision: 1,
            dataJson: "{}",
            unitsJson: "[]",
            technicianSignatureUrl: null,
            customerSignatureUrl: null,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function upload(overrides: Record<string, unknown> = {}) {
  return {
    id: "upl-1",
    storedName: "upl-1.jpg",
    originalName: "bilde.jpg",
    mimeType: "image/jpeg",
    size: 4,
    createdAt: new Date("2026-11-01T09:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.UPLOAD_DIR = "/tmp/evidence";
  delete process.env.AUDIT_EXPORT_SIGNING_KEY;
  mocks.prisma.workOrder.findUnique.mockResolvedValue(workOrder());
  mocks.prisma.upload.findMany.mockResolvedValue([upload()]);
  mocks.prisma.auditLog.findMany.mockResolvedValue([auditRow()]);
  mocks.prisma.$transaction.mockImplementation(
    async (callback: (tx: typeof mocks.prisma) => unknown) =>
      callback(mocks.prisma),
  );
  mocks.prisma.auditLog.findFirst.mockResolvedValue(null);
  mocks.prisma.auditLog.create.mockResolvedValue({});
  mocks.readFile.mockImplementation(async (filePath: string) => {
    if (filePath.endsWith("sig.png")) return Buffer.from("SIGN");
    if (filePath.endsWith("upl-1.jpg")) return Buffer.from("JPEG");
    throw new Error("ENOENT");
  });
});

describe("bevis-eksport", () => {
  it("nekter andre enn administrator", async () => {
    const result = await exportEvidenceArchive(
      actor({ role: "OFFICE" }),
      "wo-1",
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    expect(mocks.prisma.workOrder.findUnique).not.toHaveBeenCalled();
  });

  it("avviser utrygge oppdrags-id-er", async () => {
    const result = await exportEvidenceArchive(actor(), "../../etc/passwd");
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("bygger en komplett pakke for ett oppdrag", async () => {
    const result = await exportEvidenceArchive(actor(), "wo-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entries = readZip(result.data.buffer);
    const paths = entries.map((entry) => entry.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "work-order.json",
        "customer.json",
        "reports/r1.json",
        "reports/r1/revisions/1.json",
        "audit/audit.jsonl",
        "manifest.json",
        "manifest.sha256",
        "README.txt",
      ]),
    );
    expect(paths.some((entry) => entry.startsWith("files/"))).toBe(true);
    expect(paths.some((entry) => entry.startsWith("files/sig.png"))).toBe(true);
    expect(result.data.fileName).toMatch(/^bevis-O-261101-ABC-.*\.zip$/);
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "WorkOrder",
          entityId: "wo-1",
          action: expect.stringContaining("bevispakke"),
        }),
      }),
    );

    const verification = verifyEvidenceArchive(result.data.buffer);
    expect(verification.ok).toBe(true);
    expect(verification.workOrderId).toBe("wo-1");
    expect(verification.auditHashesOk).toBe(true);
    expect(verification.auditRowsChecked).toBe(1);
  });

  it("registrerer en manglende fil i manifestet uten å stoppe pakken", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([
      upload({ id: "upl-2", storedName: "borte.pdf", originalName: "borte.pdf" }),
    ]);
    mocks.prisma.workOrder.findUnique.mockResolvedValue(
      workOrder({ attachments: [] }),
    );

    const result = await exportEvidenceArchive(actor(), "wo-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.manifest.missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "file_not_found" }),
      ]),
    );
    expect(verifyEvidenceArchive(result.data.buffer).ok).toBe(true);
  });

  it("leser aldri filer utenfor opplastingsmappen", async () => {
    mocks.prisma.upload.findMany.mockResolvedValue([
      upload({ storedName: "../../etc/passwd", originalName: "passwd" }),
    ]);
    mocks.prisma.workOrder.findUnique.mockResolvedValue(
      workOrder({ attachments: [] }),
    );

    const result = await exportEvidenceArchive(actor(), "wo-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.manifest.missing).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "unsafe_path" })]),
    );
    expect(mocks.readFile).not.toHaveBeenCalledWith(
      expect.stringContaining("etc/passwd"),
    );
  });

  it("avviser URL-er med traversering", () => {
    expect(storedNameFromUploadUrl("/uploads/../secret.pdf")).toBeNull();
    expect(storedNameFromUploadUrl("/uploads/ok.pdf")).toBe("ok.pdf");
    expect(storedNameFromUploadUrl("https://example.test/x.pdf")).toBeNull();
  });

  it("oppdager at en fil er endret", async () => {
    const result = await exportEvidenceArchive(actor(), "wo-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entries = readZip(result.data.buffer);
    const tampered = entries.map((entry) =>
      entry.path === "work-order.json"
        ? { path: entry.path, data: Buffer.from('{"title":"endret"}') }
        : { path: entry.path, data: entry.data },
    );
    const verification = verifyEvidenceArchive(createZip(tampered));

    expect(verification.ok).toBe(false);
    expect(verification.errors.join(" ")).toContain("work-order.json");
  });

  it("oppdager at en revisjonsrad er endret", async () => {
    mocks.prisma.auditLog.findMany.mockResolvedValue([
      { ...auditRow(), action: "Endret av angriper" },
    ]);

    const result = await exportEvidenceArchive(actor(), "wo-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const verification = verifyEvidenceArchive(result.data.buffer);
    expect(verification.ok).toBe(false);
    expect(verification.auditHashesOk).toBe(false);
  });

  it("gir ikke funnet for ukjent oppdrag", async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue(null);
    const result = await exportEvidenceArchive(actor(), "wo-x");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});
