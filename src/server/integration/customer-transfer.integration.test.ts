import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { createZip, readZip, sha256Hex } from "@/lib/zip";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import { buildCustomerPackage } from "@/lib/customer-transfer/build-package";
import { readPackage } from "@/lib/customer-transfer/read-package";
import {
  cleanupExpiredTransfers,
  createTransferJob,
  writeStagedPackage,
} from "@/lib/customer-transfer/jobs";
import {
  confirmImport,
  createImportJob,
  dryRunImport,
  exportCustomerPackage,
} from "@/server/customer-transfer";
import type { ServiceActor } from "@/server/actor";
import { parseChecksumsFile } from "@/lib/customer-transfer/manifest";
import { analysePackage } from "@/lib/customer-transfer/analyse";
import { DEFAULT_POLICIES } from "@/lib/customer-transfer/constants";

const describeIntegration = integrationEnabled ? describe : describe.skip;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=",
  "base64",
);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
);

function actorFrom(user: {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  isActive: boolean;
  departmentId: string | null;
}): ServiceActor {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    departmentId: user.departmentId,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: { permissions: [] },
  };
}

describeIntegration("Kundeoverføring mot ekte PostgreSQL", () => {
  const ids = {
    departmentId: "",
    departmentBId: "",
    adminId: "",
    officeId: "",
    technicianId: "",
    templateId: "",
    slaId: "",
    priceListId: "",
    categoryRootId: "",
    categoryMidId: "",
    categoryLeafId: "",
    folderRootId: "",
    folderChildId: "",
    customerAId: "",
    customerBId: "",
    portalUserId: "",
    workOrderIds: [] as string[],
    reportId: "",
    documentId: "",
    versionId: "",
    globalDocumentId: "",
    planId: "",
    contractId: "",
    productId: "",
    tagId: "",
    documentTagId: "",
    customerAttachmentId: "",
  };
  let tempRoot = "";
  let admin: ServiceActor;
  let sourceCustomerName = "";
  let sourceQrValue = "";
  let packageBuffer: Buffer = Buffer.alloc(0);
  let packageChecksum = "";
  let packageHashes = new Set<string>();
  let sourceIds = new Set<string>();
  let counts: Record<string, number> = {};
  let importJobId = "";
  let previewToken = "";
  let sourcePortalEmail = "";
  let sourceDocumentHash = "";
  let beforeImportUsers = 0;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-cust-transfer-"));
    process.env.UPLOAD_DIR = tempRoot;

    for (const [key, permissions] of [
      ["ADMIN", []],
      ["OFFICE", ["settings.manage"]],
      ["TECHNICIAN", []],
      ["CUSTOMER", []],
      ["USER", []],
    ] as const) {
      await prisma.role.upsert({
        where: { key },
        update: {},
        create: { key, label: key, permissions: [...permissions], isSystem: true },
      });
    }

    const department = await prisma.department.create({
      data: { name: unique("CT-avdeling") },
    });
    const departmentB = await prisma.department.create({
      data: { name: unique("CT-avdeling-B") },
    });
    ids.departmentId = department.id;
    ids.departmentBId = departmentB.id;

    const adminUser = await prisma.user.create({
      data: {
        name: "CT Admin",
        email: `${unique("ct-admin")}@example.test`,
        role: "ADMIN",
        isActive: true,
        departmentId: department.id,
      },
    });
    const officeUser = await prisma.user.create({
      data: {
        name: "CT Office",
        email: `${unique("ct-office")}@example.test`,
        role: "OFFICE",
        isActive: true,
        departmentId: department.id,
        permissionsCustomized: true,
        permissions: ["settings.manage"],
      },
    });
    const technicianUser = await prisma.user.create({
      data: {
        name: "CT Technician",
        email: `${unique("ct-tech")}@example.test`,
        role: "TECHNICIAN",
        isActive: true,
        departmentId: department.id,
      },
    });
    ids.adminId = adminUser.id;
    ids.officeId = officeUser.id;
    ids.technicianId = technicianUser.id;
    admin = actorFrom(adminUser);

    const template = await prisma.template.create({
      data: {
        title: unique("CT mal"),
        category: "SERVICE",
        requiresUnits: true,
        fieldsJson: "[]",
      },
    });
    ids.templateId = template.id;
    const sla = await prisma.slaPolicy.create({
      data: {
        name: unique("CT SLA"),
        departmentId: department.id,
        responseMinutes: 60,
        resolutionMinutes: 240,
      },
    });
    ids.slaId = sla.id;
    const priceList = await prisma.priceList.create({
      data: {
        name: unique("CT prisliste"),
        items: {
          create: { code: "A1", label: "Time", unit: "time", amount: "1250.00" },
        },
      },
    });
    ids.priceListId = priceList.id;

    const tag = await prisma.tag.create({
      data: { name: unique("CT-tag"), color: "#123456" },
    });
    ids.tagId = tag.id;
    const documentTag = await prisma.documentTag.create({
      data: { name: unique("CT-doktag"), color: "#654321" },
    });
    ids.documentTagId = documentTag.id;

    const categoryRoot = await prisma.equipmentCategory.create({
      data: { name: unique("CT Bygg") },
    });
    const categoryMid = await prisma.equipmentCategory.create({
      data: { name: unique("CT System"), parentId: categoryRoot.id },
    });
    const categoryLeaf = await prisma.equipmentCategory.create({
      data: { name: unique("CT Enhet"), parentId: categoryMid.id },
    });
    ids.categoryRootId = categoryRoot.id;
    ids.categoryMidId = categoryMid.id;
    ids.categoryLeafId = categoryLeaf.id;

    const folderRoot = await prisma.documentFolder.create({
      data: { name: unique("CT Dokumenter") },
    });
    const folderChild = await prisma.documentFolder.create({
      data: { name: unique("CT Rapporter"), parentId: folderRoot.id },
    });
    ids.folderRootId = folderRoot.id;
    ids.folderChildId = folderChild.id;

    sourceCustomerName = unique("CT Kunde A");
    const customerA = await prisma.customer.create({
      data: {
        name: sourceCustomerName,
        customerNumber: unique("KA"),
        orgNumber: "912 345 678",
        brandColor: "#112233",
        address: "Testveien 1",
        postalCode: "0123",
        city: "Oslo",
        phone: "12345678",
        email: `${unique("kunde-a")}@example.test`,
        notes: "Syntetisk testkunde",
        departmentId: department.id,
        responsibleTechnicianId: technicianUser.id,
      },
    });
    const customerB = await prisma.customer.create({
      data: {
        name: unique("CT Kunde B"),
        customerNumber: unique("KB"),
        orgNumber: "998 877 665",
        departmentId: departmentB.id,
      },
    });
    ids.customerAId = customerA.id;
    ids.customerBId = customerB.id;

    const portal = await prisma.user.create({
      data: {
        name: "Portal Person",
        email: `${unique("portal")}@example.test`,
        role: "CUSTOMER",
        isActive: true,
        customerId: customerA.id,
        password: "$2b$10$hash-som-aldri-skal-eksporteres",
        twoFactorSecret: "TOTP-HEMMELIGHET",
        emailVerified: new Date(),
      },
    });
    ids.portalUserId = portal.id;
    sourcePortalEmail = portal.email ?? "";

    const contact = await prisma.contact.create({
      data: {
        name: "Kontakt Person",
        email: `${unique("kontakt")}@example.test`,
        phone: "99887766",
        customerId: customerA.id,
        locale: "nb",
      },
    });
    await prisma.portalDelegation.create({
      data: {
        contactId: contact.id,
        canBook: true,
        canViewDocuments: true,
        isActive: true,
      },
    });
    const contactB = await prisma.contact.create({
      data: {
        name: "Kontakt B",
        email: `${unique("kontakt-b")}@example.test`,
        customerId: customerB.id,
      },
    });
    void contactB;

    await prisma.customerSite.create({
      data: {
        customerId: customerA.id,
        name: unique("Hovedanlegg"),
        address: "Testveien 1",
        city: "Oslo",
        latitude: 59.91,
        longitude: 10.75,
        isPrimary: true,
      },
    });
    await prisma.customerSite.create({
      data: { customerId: customerA.id, name: unique("Lager") },
    });

    const building = await prisma.product.create({
      data: {
        model: "Bygg",
        serialNumber: "SN-BUILDING",
        customerId: customerA.id,
        categoryId: categoryRoot.id,
        status: "ACTIVE",
        criticality: 1,
        qrToken: "gammel-qr-token-skal-ikke-gjenbrukes",
      },
    });
    const system = await prisma.product.create({
      data: {
        model: "System",
        serialNumber: "SN-SYSTEM",
        customerId: customerA.id,
        categoryId: categoryMid.id,
        parentId: building.id,
      },
    });
    const unit = await prisma.product.create({
      data: {
        model: "Pumpe",
        serialNumber: "SN-12345",
        location: "Kjeller",
        customerId: customerA.id,
        categoryId: categoryLeaf.id,
        parentId: system.id,
        meterUnit: "timer",
        installDate: new Date("2024-01-01"),
        warrantyUntil: new Date("2027-01-01"),
      },
    });
    ids.productId = unit.id;
    sourceQrValue = unique("LEGACY-INT-");
    await prisma.equipmentQrCode.create({
      data: {
        productId: unit.id,
        value: sourceQrValue,
        normalizedValue: sourceQrValue,
        label: "Gammel QR – pumpe",
        source: "MANUAL",
      },
    });
    // Samme serienummer hos en annen kunde: må ikke krysstilknyttes.
    await prisma.product.create({
      data: {
        model: "Pumpe B",
        serialNumber: "SN-12345",
        customerId: customerB.id,
      },
    });

    await prisma.meterReading.create({
      data: {
        productId: unit.id,
        value: "123.45",
        readAt: new Date("2026-01-01T10:00:00Z"),
        source: "MANUAL",
      },
    });

    const plan = await prisma.maintenancePlan.create({
      data: {
        title: unique("CT plan"),
        trigger: "CALENDAR",
        intervalMonths: 12,
        leadDays: 14,
        nextDueDate: new Date("2026-06-01"),
        customerId: customerA.id,
        departmentId: department.id,
        templateId: template.id,
        productId: unit.id,
      },
    });
    ids.planId = plan.id;
    await prisma.maintenancePlanOccurrence.create({
      data: { planId: plan.id, dueDate: new Date("2026-06-01"), status: "PENDING" },
    });

    const contract = await prisma.contract.create({
      data: {
        title: unique("CT avtale"),
        contractNumber: unique("AV"),
        intervalMonths: 12,
        startDate: new Date("2025-01-01"),
        nextServiceDate: new Date("2026-01-01"),
        status: "ACTIVE",
        customerId: customerA.id,
        departmentId: department.id,
        templateId: template.id,
        slaPolicyId: sla.id,
        priceListId: priceList.id,
        lines: {
          create: {
            productId: unit.id,
            scope: "Alt utstyr",
            visitsPerYear: 2,
            responseMinutes: 60,
          },
        },
      },
    });
    ids.contractId = contract.id;

    const workOrderA = await prisma.workOrder.create({
      data: {
        title: "CT åpent oppdrag",
        reference: unique("O-"),
        status: "OPEN",
        departmentId: department.id,
        customerId: customerA.id,
        productId: unit.id,
        contactId: contact.id,
        contractId: contract.id,
        tags: { connect: { id: tag.id } },
        templates: { connect: { id: template.id } },
        technicians: { connect: { id: technicianUser.id } },
      },
    });
    const workOrderB = await prisma.workOrder.create({
      data: {
        title: "CT fullført oppdrag",
        reference: unique("O-"),
        status: "COMPLETED",
        departmentId: department.id,
        customerId: customerA.id,
        scheduledFor: new Date("2026-02-01"),
      },
    });
    const workOrderDeleted = await prisma.workOrder.create({
      data: {
        title: "CT slettet oppdrag",
        reference: unique("O-"),
        status: "CANCELLED",
        departmentId: department.id,
        customerId: customerA.id,
        deletedAt: new Date("2026-02-02"),
        deletedBy: "test",
      },
    });
    const workOrderLegal = await prisma.workOrder.create({
      data: {
        title: "CT legal hold",
        reference: unique("O-"),
        status: "OPEN",
        departmentId: department.id,
        customerId: customerA.id,
        legalHold: true,
      },
    });
    ids.workOrderIds = [
      workOrderA.id,
      workOrderB.id,
      workOrderDeleted.id,
      workOrderLegal.id,
    ];

    const visit = await prisma.visit.create({
      data: {
        workOrderId: workOrderA.id,
        sequence: 1,
        startsAt: new Date("2026-03-01T08:00:00Z"),
        endsAt: new Date("2026-03-01T10:00:00Z"),
        status: "DONE",
        doneAt: new Date("2026-03-01T10:00:00Z"),
      },
    });
    await prisma.visitTechnician.create({
      data: { visitId: visit.id, userId: technicianUser.id },
    });
    await prisma.comment.create({
      data: {
        content: "Syntetisk servicekommentar",
        authorName: "CT Technician",
        workOrderId: workOrderA.id,
        customerId: customerA.id,
        contactId: contact.id,
      },
    });
    await prisma.meterReading.create({
      data: {
        productId: unit.id,
        value: "130.00",
        readAt: new Date("2026-03-01T10:00:00Z"),
        source: "VISIT",
        visitId: visit.id,
        userId: technicianUser.id,
      },
    });

    const reportPdfStored = `${randomUUID()}.pdf`;
    await fs.writeFile(path.join(tempRoot, reportPdfStored), PDF);
    const signatureStored = `${randomUUID()}.png`;
    await fs.writeFile(path.join(tempRoot, signatureStored), PNG);
    const report = await prisma.report.create({
      data: {
        dataJson: JSON.stringify({ summary: "Syntetisk rapport" }),
        comments: "Alt ok",
        completedAt: new Date("2026-03-01T10:00:00Z"),
        technicianSignatureUrl: `/uploads/${signatureStored}`,
        technicianName: "CT Technician",
        workOrderId: workOrderA.id,
        templateId: template.id,
        templateTitle: template.title,
        name: "CT service rapport",
        reportNumber: unique("R"),
        requiresUnits: true,
        isLocked: true,
        lockedAt: new Date("2026-03-02T10:00:00Z"),
        lockedByName: "CT Admin",
        pdfUrl: `/uploads/${reportPdfStored}`,
        pdfHash: sha256Hex(PDF),
        pdfGeneratedAt: new Date("2026-03-01T10:00:00Z"),
        revision: 2,
        units: {
          create: [
            {
              label: "Pumpe 1",
              serialNumber: "SN-12345",
              status: "GODKJENT",
              answersJson: JSON.stringify({ ok: true }),
              productId: unit.id,
              sortOrder: 0,
            },
            {
              label: "Pumpe 2",
              status: "AVVIK",
              answersJson: JSON.stringify({ ok: false }),
              sortOrder: 1,
            },
          ],
        },
        revisions: {
          create: [
            {
              revision: 1,
              dataJson: JSON.stringify({ summary: "Første" }),
              unitsJson: "[]",
              templateTitle: template.title,
              reason: "Første lagring",
            },
            {
              revision: 2,
              dataJson: JSON.stringify({ summary: "Andre" }),
              unitsJson: "[]",
              templateTitle: template.title,
              reason: "Signering",
              technicianSignatureUrl: `/uploads/${signatureStored}`,
            },
          ],
        },
      },
    });
    ids.reportId = report.id;

    // Kundevedlegg som data-URL og opplastinger på kunde/utstyr/oppdrag.
    const attachment = await prisma.customerAttachment.create({
      data: {
        customerId: customerA.id,
        fileName: "kvittering.png",
        dataUrl: `data:image/png;base64,${PNG.toString("base64")}`,
      },
    });
    ids.customerAttachmentId = attachment.id;

    for (const [ownerType, ownerId, name] of [
      ["CUSTOMER", customerA.id, "kundefil.png"],
      ["EQUIPMENT", unit.id, "utstyrsbilde.png"],
      ["WORK_ORDER", workOrderA.id, "oppdragsfil.png"],
    ] as const) {
      const storedName = `${randomUUID()}.png`;
      await fs.writeFile(path.join(tempRoot, storedName), PNG);
      await prisma.upload.create({
        data: {
          storedName,
          originalName: name,
          mimeType: "image/png",
          size: PNG.length,
          ownerType,
          ownerId,
          customerId: customerA.id,
          departmentId: department.id,
          uploadedById: adminUser.id,
          contentHash: sha256Hex(PNG),
        },
      });
    }

    const documentStored = `${randomUUID()}.pdf`;
    await fs.writeFile(path.join(tempRoot, documentStored), Buffer.concat([PDF, Buffer.from("\n% doc")]));
    const docFile = Buffer.concat([PDF, Buffer.from("\n% doc")]);
    sourceDocumentHash = sha256Hex(docFile);
    const document = await prisma.document.create({
      data: {
        title: "CT dokument",
        description: "Syntetisk dokument",
        fileName: "dokument.pdf",
        filePath: `/uploads/${documentStored}`,
        fileSize: docFile.length,
        mimeType: "application/pdf",
        contentText: "syntetisk tekst",
        customerId: customerA.id,
        productId: unit.id,
        folderId: folderChild.id,
        uploadedBy: "CT Admin",
        tags: { connect: { id: documentTag.id } },
      },
    });
    ids.documentId = document.id;
    const versionStored = `${randomUUID()}.png`;
    await fs.writeFile(path.join(tempRoot, versionStored), PNG);
    const version = await prisma.documentVersion.create({
      data: {
        documentId: document.id,
        fileName: "tidligere.png",
        filePath: `/uploads/${versionStored}`,
        fileSize: PNG.length,
        mimeType: "image/png",
        createdBy: "CT Admin",
      },
    });
    ids.versionId = version.id;

    // Globalt dokument uten eier: skal aldri eksporteres.
    const globalStored = `${randomUUID()}.pdf`;
    await fs.writeFile(path.join(tempRoot, globalStored), PDF);
    const globalDocument = await prisma.document.create({
      data: {
        title: "CT globalt dokument",
        fileName: "global.pdf",
        filePath: `/uploads/${globalStored}`,
        fileSize: PDF.length,
        mimeType: "application/pdf",
      },
    });
    ids.globalDocumentId = globalDocument.id;

    // Kunde B: samme dokumentinnhold, samme kontakt-e-post og serienummer.
    await prisma.document.create({
      data: {
        title: "CT dokument B",
        fileName: "dokument.pdf",
        filePath: `/uploads/${documentStored}`,
        fileSize: docFile.length,
        mimeType: "application/pdf",
        customerId: customerB.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        entityType: "Customer",
        entityId: customerA.id,
        action: "Opprettet kunde",
        userName: "CT Admin",
        actorId: adminUser.id,
        metadata: { source: "integration-test" },
      },
    });

    // Eksporter kunde A med slettede og legal-hold-rader.
    const built = await buildCustomerPackage(admin, {
      customerIds: [customerA.id],
      includeFiles: true,
      includeDeleted: true,
      includeLegalHold: true,
      includeAudit: true,
      includeSignatures: false,
    });
    packageBuffer = built.buffer;
    packageChecksum = built.checksum;
    counts = built.counts;
    packageHashes = new Set(built.manifest.files.map((file) => file.sha256));
    const read = readPackage(packageBuffer);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("package invalid");
    // Testene kjører kilde og mål i samme database. En ekstern QR-kode er
    // globalt unik, så kildekoden fjernes etter eksport for å simulere en
    // overføring til en annen installasjon.
    await prisma.equipmentQrCode.deleteMany({ where: { productId: unit.id } });
    sourceIds = new Set<string>();
    for (const [key, rows] of Object.entries(read.result.dataset)) {
      if (key === "auditSnapshot" || key === "users" || key === "departments") continue;
      for (const row of rows as Array<{ id: string }>) sourceIds.add(row.id);
    }
  });

  afterAll(async () => {
    await cleanupExpiredTransfers();
    // Slett kundedata i avhengighetsrekkefølge.
    const fixtureCustomers = await prisma.customer.findMany({
      where: { name: { startsWith: "CT Kunde" } },
      select: { id: true },
    });
    const customerIds = [
      ...new Set([
        ids.customerAId,
        ids.customerBId,
        ...fixtureCustomers.map((customer) => customer.id),
      ]),
    ].filter(Boolean);
    const workOrders = await prisma.workOrder.findMany({
      where: { OR: [{ customerId: { in: customerIds } }, { id: { in: ids.workOrderIds } }] },
      select: { id: true },
    });
    const workOrderIds = workOrders.map((order) => order.id);
    await prisma.report.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
    await prisma.visit.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
    await prisma.comment.deleteMany({
      where: { OR: [{ customerId: { in: customerIds } }, { workOrderId: { in: workOrderIds } }] },
    });
    await prisma.attachment.deleteMany({ where: { workOrderId: { in: workOrderIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
    await prisma.contract.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.maintenancePlan.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.meterReading.deleteMany({ where: { product: { customerId: { in: customerIds } } } });
    await prisma.product.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.document.deleteMany({
      where: {
        OR: [
          { customerId: { in: customerIds } },
          { id: ids.globalDocumentId },
          { title: { startsWith: "CT dokument" } },
        ],
      },
    });
    await prisma.upload.deleteMany({
      where: {
        OR: [
          { customerId: { in: customerIds } },
          { ownerId: { in: [...workOrderIds, ...customerIds] } },
          { uploadedById: { in: [ids.adminId, ids.officeId, ids.technicianId] } },
        ],
      },
    });
    await prisma.customerAttachment.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.portalDelegation.deleteMany({
      where: { contact: { customerId: { in: customerIds } } },
    });
    await prisma.contact.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerSite.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.user.deleteMany({
      where: { OR: [{ customerId: { in: customerIds } }, { id: { in: [ids.adminId, ids.officeId, ids.technicianId] } }] },
    });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.documentFolder.deleteMany({
      where: { id: { in: [ids.folderRootId, ids.folderChildId] } },
    });
    await prisma.equipmentCategory.deleteMany({
      where: { id: { in: [ids.categoryLeafId, ids.categoryMidId, ids.categoryRootId] } },
    });
    await prisma.tag.deleteMany({ where: { id: ids.tagId } });
    await prisma.documentTag.deleteMany({ where: { id: ids.documentTagId } });
    await prisma.template.deleteMany({ where: { id: ids.templateId } });
    await prisma.slaPolicy.deleteMany({ where: { id: ids.slaId } });
    await prisma.priceList.deleteMany({ where: { id: ids.priceListId } });
    await prisma.department.deleteMany({
      where: { id: { in: [ids.departmentId, ids.departmentBId] } },
    });
    await prisma.customerTransferJob.deleteMany({
      where: { actorId: { in: [ids.adminId, ids.officeId, ids.technicianId] } },
    });
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("produserer en deterministisk ZIP med manifest, sjekksummer og riktig innhold", () => {
    const entries = readZip(packageBuffer);
    const paths = entries.map((entry) => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("manifest.json");
    expect(paths).toContain("checksums.sha256");
    expect(paths).toContain("README.txt");
    expect(paths).toContain("provenance/source-info.json");
    expect(paths).toContain("provenance/audit.json");
    expect(paths.some((entry) => entry.startsWith("files/"))).toBe(true);
    expect(paths.some((entry) => entry.startsWith("/"))).toBe(false);
    expect(paths.some((entry) => entry.includes("\\") || entry.includes(".."))).toBe(false);

    const byPath = new Map(entries.map((entry) => [entry.path, entry.data]));
    const manifest = JSON.parse((byPath.get("manifest.json") ?? Buffer.from("{}")).toString("utf8"));
    expect(manifest.format).toBe("fsm-customer-export");
    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.counts).toEqual(counts);
    expect(manifest.counts.customers).toBe(1);
    expect(manifest.counts.portalUsers).toBe(1);
    expect(manifest.counts.products).toBeGreaterThanOrEqual(3);
    expect(manifest.counts.equipmentQrCodes).toBe(1);
    expect(manifest.counts.reports).toBe(1);
    expect(manifest.counts.documents).toBe(1);

    const listed = parseChecksumsFile((byPath.get("checksums.sha256") ?? Buffer.from("")).toString("utf8"));
    for (const [filePath, checksum] of Object.entries(manifest.checksums as Record<string, string>)) {
      expect(sha256Hex(byPath.get(filePath) as Buffer)).toBe(checksum);
      expect(listed.get(filePath)).toBe(checksum);
    }
    for (const file of manifest.files as Array<{ path: string; sha256: string; size: number }>) {
      const data = byPath.get(file.path) as Buffer;
      expect(sha256Hex(data)).toBe(file.sha256);
      expect(data.length).toBe(file.size);
      expect(file.path).toMatch(/^files\/[a-f0-9]{2}\/[a-f0-9]{64}\.(pdf|png|jpg|jpeg|webp|gif)$/);
      expect(file.path).toContain(file.sha256);
    }

    const dataText = entries
      .filter((entry) => entry.path.startsWith("data/"))
      .map((entry) => entry.data.toString("utf8"))
      .join("\n");
    for (const forbidden of [
      "\"password\"",
      "passwordHash",
      "twoFactorSecret",
      "twoFactorRecovery",
      "keyHash",
      "sessionToken",
      "qrToken\"",
      "hash-som-aldri",
      "TOTP-HEMMELIGHET",
    ]) {
      expect(dataText).not.toContain(forbidden);
    }
    expect(dataText).not.toContain(ids.globalDocumentId);
    expect(dataText).toContain(ids.customerAId);
    expect(dataText).toContain("\"signatureExcluded\": true");
    expect(dataText).not.toContain("\"technicianSignatureUrl\": \"/uploads/");

    const customerJson = JSON.parse((byPath.get("data/customers.json") ?? Buffer.from("[]")).toString("utf8"));
    expect(customerJson).toHaveLength(1);
    expect(customerJson[0].name).toBe(sourceCustomerName);
  });

  it("dry-run gir handlinger uten å skrive kundedata", async () => {
    // Slett kilden for å simulere import til en ren kundebase.
    const deleteResult = await deleteCustomerDossier(ids.customerAId);
    expect(deleteResult).toBeGreaterThan(0);
    const before = await prisma.customer.count();
    beforeImportUsers = await prisma.user.count({ where: { role: { not: "CUSTOMER" } } });

    const job = await createImportJob(admin, packageBuffer, "package.zip");
    expect(job.ok).toBe(true);
    if (!job.ok) return;
    importJobId = job.data.id;

    const preview = await dryRunImport(admin, importJobId);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.package.schemaVersion).toBe("1.0");
    expect(preview.data.package.checksum).toBe(packageChecksum);
    expect(preview.data.errors).toEqual([]);
    expect(preview.data.canImport).toBe(true);
    expect(preview.data.counts.create).toBeGreaterThan(0);
    expect(preview.data.previewToken).toBeTruthy();
    previewToken = preview.data.previewToken ?? "";

    // Ingen domene-skriving, ingen flytting av filer.
    expect(await prisma.customer.count()).toBe(before);
    expect(await prisma.workOrder.count({ where: { customerId: { in: [...sourceIds] } } })).toBe(0);
    const uploads = await prisma.upload.count();
    expect(uploads).toBe(0);
  });

  it("importerer pakken i én transaksjon med nye ID-er og alle relasjoner", async () => {
    const result = await confirmImport(admin, importJobId, {
      previewToken,
      policies: {},
      createMissingReferences: false,
      confirmation: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("COMPLETED");
    expect(result.data.counts.create).toBeGreaterThan(0);

    const customer = await prisma.customer.findFirst({
      where: { name: sourceCustomerName },
      include: {
        contacts: { include: { portalDelegation: true } },
        sites: true,
        contracts: { include: { lines: true } },
        products: true,
        maintenancePlans: { include: { occurrences: true } },
        workOrder: { include: { visits: { include: { technicians: true } }, tags: true } },
        attachments: true,
        documents: { include: { versions: true, tags: true } },
      },
    });
    expect(customer).toBeTruthy();
    if (!customer) return;
    expect(customer.id).not.toBe(ids.customerAId);
    expect(sourceIds.has(customer.id)).toBe(false);
    expect(customer.contacts).toHaveLength(1);
    expect(customer.contacts[0].portalDelegation?.canBook).toBe(true);
    expect(customer.sites).toHaveLength(2);
    expect(customer.contracts).toHaveLength(1);
    expect(customer.contracts[0].id).not.toBe(ids.contractId);
    expect(customer.contracts[0].lines).toHaveLength(1);
    expect(customer.products).toHaveLength(3);
    expect(customer.maintenancePlans).toHaveLength(1);
    expect(customer.maintenancePlans[0].occurrences).toHaveLength(1);
    expect(customer.workOrder.length).toBe(4);
    const openOrder = customer.workOrder.find((order) => order.title === "CT åpent oppdrag");
    expect(openOrder).toBeTruthy();
    expect(openOrder?.visits[0].technicians).toHaveLength(1);
    expect(openOrder?.tags).toHaveLength(1);
    expect(customer.documents).toHaveLength(1);
    expect(customer.documents[0].versions).toHaveLength(1);
    expect(customer.documents[0].tags).toHaveLength(1);
    expect(customer.attachments).toHaveLength(1);

    // Hierarki og kategoritre.
    const unit = customer.products.find((product) => product.model === "Pumpe");
    expect(unit?.parentId).toBeTruthy();
    expect(unit?.qrToken).toBeNull();
    const importedQr = await prisma.equipmentQrCode.findUnique({
      where: { normalizedValue: sourceQrValue },
    });
    expect(importedQr?.productId).toBe(unit?.id);
    expect(importedQr?.source).toBe("IMPORT");
    expect(importedQr?.label).toBe("Gammel QR – pumpe");
    const system = customer.products.find((product) => product.model === "System");
    expect(system?.parentId).toBeTruthy();
    const leafCategory = await prisma.equipmentCategory.findUnique({
      where: { id: unit?.categoryId ?? "" },
      include: { parent: { include: { parent: true } } },
    });
    expect(leafCategory?.parent?.parent?.id).toBeTruthy();

    // Rapport med enheter, revisjoner, lås og PDF.
    const report = await prisma.report.findFirst({
      where: { workOrderId: openOrder?.id },
      include: { units: true, revisions: true },
    });
    expect(report).toBeTruthy();
    expect(report?.id).not.toBe(ids.reportId);
    expect(report?.isLocked).toBe(true);
    expect(report?.revision).toBe(2);
    expect(report?.units).toHaveLength(2);
    expect(report?.revisions).toHaveLength(2);
    expect(report?.pdfUrl).toMatch(/^\/uploads\/[0-9a-f-]+\.pdf$/);
    const pdfData = await fs.readFile(path.join(tempRoot, (report?.pdfUrl ?? "").replace("/uploads/", "")));
    expect(sha256Hex(pdfData)).toBe(sha256Hex(PDF));
    // Signaturbilder er som standard ikke med.
    expect(report?.technicianSignatureUrl).toBeNull();

    // Portalbrukere importeres deaktivert uten passord, og e-posten er ny.
    const portal = await prisma.user.findFirst({
      where: { customerId: customer.id, role: "CUSTOMER" },
    });
    expect(portal?.id).not.toBe(ids.portalUserId);
    expect(portal?.isActive).toBe(false);
    expect(portal?.password).toBeNull();
    expect(portal?.twoFactorSecret).toBeNull();
    expect(portal?.email).toBe(sourcePortalEmail);
    expect(portal?.emailVerified).toBeNull();

    // Ingen ansatte er opprettet.
    expect(
      await prisma.user.count({ where: { role: { not: "CUSTOMER" } } }),
    ).toBe(beforeImportUsers);

    // Alle importerte filer er byte-identiske med pakken og referert.
    const uploads = await prisma.upload.findMany({
      where: {
        OR: [
          { customerId: customer.id },
          { ownerId: { in: customer.workOrder.map((order) => order.id) } },
        ],
      },
    });
    expect(uploads.length).toBeGreaterThan(0);
    for (const upload of uploads) {
      const data = await fs.readFile(path.join(tempRoot, upload.storedName));
      expect(packageHashes.has(sha256Hex(data))).toBe(true);
    }
    expect(packageHashes.has(sha256Hex(pdfData))).toBe(true);

    // Dokumentet har fått ny filplassering og er byte-identisk.
    const document = customer.documents[0];
    expect(document.filePath).toMatch(/^\/uploads\/[0-9a-f-]+\.pdf$/);
    const docData = await fs.readFile(path.join(tempRoot, document.filePath.replace("/uploads/", "")));
    expect(sha256Hex(docData)).toBe(sourceDocumentHash);

    // Revisjonsloggen har en ekte import-hendelse, og kilde-audit er ikke kopiert.
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "CustomerTransfer", entityId: importJobId },
    });
    expect(auditEntry?.action).toContain("Importerte kundepakke");
    expect(auditEntry?.metadata).not.toHaveProperty("customerName");

    // Mappingen er lagret og peker på nye mål-ID-er.
    const records = await prisma.customerTransferRecord.findMany({
      where: { jobId: importJobId, sourceEntityType: "Customer" },
    });
    expect(records).toHaveLength(1);
    expect(records[0].targetId).toBe(customer.id);
    expect(records[0].sourceId).toBe(ids.customerAId);
  });

  it("hopper over alt ved en ny import av samme pakke", async () => {
    const beforeCustomers = await prisma.customer.count();
    const beforeOrders = await prisma.workOrder.count();
    const job = await createImportJob(admin, packageBuffer, "package.zip");
    expect(job.ok).toBe(true);
    if (!job.ok) return;
    const preview = await dryRunImport(admin, job.data.id);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.canImport).toBe(true);
    expect(preview.data.counts.create).toBe(0);
    expect(preview.data.counts.skip).toBeGreaterThan(0);
    const token = preview.data.previewToken ?? "";
    const result = await confirmImport(admin, job.data.id, {
      previewToken: token,
      policies: {},
      createMissingReferences: false,
      confirmation: true,
    });
    expect(result.ok).toBe(true);
    expect(await prisma.customer.count()).toBe(beforeCustomers);
    expect(await prisma.workOrder.count()).toBe(beforeOrders);
  });

  it("avviser skadet sjekksum og manglende fil uten skriving", async () => {
    const beforeCustomers = await prisma.customer.count();
    const beforeUploads = await prisma.upload.count();

    // Sjekksumfeil: endre en datafil uten å oppdatere manifestet.
    const originalEntries = readZip(packageBuffer);
    const corrupted = createZip(
      originalEntries.map((entry) =>
        entry.path === "data/customers.json"
          ? {
              path: entry.path,
              data: Buffer.concat([entry.data, Buffer.from(" ")]),
            }
          : { path: entry.path, data: entry.data },
      ),
    );
    const job = await createImportJob(admin, corrupted, "corrupt.zip");
    expect(job.ok).toBe(true);
    if (job.ok) {
      const preview = await dryRunImport(admin, job.data.id);
      expect(preview.ok).toBe(true);
      if (preview.ok) {
        expect(preview.data.canImport).toBe(false);
        expect(preview.data.errors.length).toBeGreaterThan(0);
      }
    }
    expect(await prisma.customer.count()).toBe(beforeCustomers);
    expect(await prisma.upload.count()).toBe(beforeUploads);

    // Manglende fil: fjern en filoppføring og bygg ZIP-en på nytt.
    const entries = originalEntries;
    const manifestEntry = entries.find((entry) => entry.path === "manifest.json");
    const manifest = JSON.parse((manifestEntry?.data ?? Buffer.from("{}")).toString("utf8"));
    const removed = (manifest.files as Array<{ path: string }>)[0].path;
    const rebuilt = createZip(
      entries
        .filter((entry) => entry.path !== removed)
        .map((entry) => ({ path: entry.path, data: entry.data })),
    );
    const missingJob = await createImportJob(admin, rebuilt, "missing.zip");
    expect(missingJob.ok).toBe(true);
    if (missingJob.ok) {
      const preview = await dryRunImport(admin, missingJob.data.id);
      expect(preview.ok).toBe(true);
      if (preview.ok) {
        expect(preview.data.canImport).toBe(false);
        expect(
          preview.data.errors.some((error) =>
            ["customer_transfer.missing_file", "customer_transfer.checksum_mismatch"].includes(
              error.code,
            ),
          ),
        ).toBe(true);
      }
    }
    expect(await prisma.customer.count()).toBe(beforeCustomers);
    expect(await prisma.upload.count()).toBe(beforeUploads);
  });

  it("avviser path traversal og dupliserte ZIP-oppføringer", async () => {
    // Lag et gyldig arkiv, og bytt deretter ut en trygg banesegment med «..».
    const zip = createZip([
      { path: "safe/xx/aaaaaaaaaaaaaaaa.json", data: Buffer.from("[]") },
    ]);
    const traversal = Buffer.from(zip);
    const from = Buffer.from("safe/xx");
    const to = Buffer.from("safe/..");
    let offset = traversal.indexOf(from);
    let replaced = 0;
    while (offset >= 0) {
      to.copy(traversal, offset);
      replaced += 1;
      offset = traversal.indexOf(from, offset + 1);
    }
    expect(replaced).toBe(2); // lokal header + sentralkatalog
    const result = readPackage(traversal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe("customer_transfer.path_traversal");
    }
  });

  it("serialiserer samtidige bekreftelser på samme pakke", async () => {
    const beforeCustomers = await prisma.customer.count();
    const job = await createImportJob(admin, packageBuffer, "concurrent.zip");
    expect(job.ok).toBe(true);
    if (!job.ok) return;
    const preview = await dryRunImport(admin, job.data.id);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const token = preview.data.previewToken ?? "";
    const [first, second] = await Promise.all([
      confirmImport(admin, job.data.id, {
        previewToken: token,
        policies: {},
        createMissingReferences: false,
        confirmation: true,
      }),
      confirmImport(admin, job.data.id, {
        previewToken: token,
        policies: {},
        createMissingReferences: false,
        confirmation: true,
      }),
    ]);
    const successes = [first, second].filter((result) => result.ok).length;
    expect(successes).toBe(1);
    expect(await prisma.customer.count()).toBe(beforeCustomers);
  });

  it("avviser eksport og import for kontor, montør, kunde og inaktiv admin", async () => {
    const office = actorFrom({
      id: ids.officeId,
      name: "CT Office",
      email: "office@example.test",
      role: "OFFICE",
      isActive: true,
      departmentId: ids.departmentId,
    });
    const technician = actorFrom({
      id: ids.technicianId,
      name: "CT Technician",
      email: "tech@example.test",
      role: "TECHNICIAN",
      isActive: true,
      departmentId: ids.departmentId,
    });
    const customerUser = actorFrom({
      id: ids.portalUserId,
      name: "Portal",
      email: sourcePortalEmail,
      role: "CUSTOMER",
      isActive: true,
      departmentId: null,
    });
    const inactiveAdmin = { ...admin, isActive: false };

    for (const actor of [office, technician, customerUser, inactiveAdmin]) {
      const exported = await exportCustomerPackage(actor, {
        customerIds: [ids.customerAId],
        includeFiles: false,
        includeDeleted: false,
        includeLegalHold: false,
        includeAudit: false,
        includeSignatures: false,
      });
      expect(exported.ok).toBe(false);
      if (!exported.ok) expect(exported.status).toBe(403);
      const deniedJob = await createImportJob(actor, packageBuffer, "denied.zip");
      expect(deniedJob.ok).toBe(false);
      if (!deniedJob.ok) expect(deniedJob.status).toBe(403);
    }
    const allowed = await createImportJob(admin, packageBuffer, "allowed.zip");
    expect(allowed.ok).toBe(true);
  });

  it("blokkerer duplikate eksterne QR-koder i samme pakke", async () => {
    const read = readPackage(packageBuffer);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const rows = read.result.dataset.equipmentQrCodes;
    expect(rows).toHaveLength(1);
    const duplicate = { ...rows[0], id: "ct-qr-duplicate" };
    read.result.dataset.equipmentQrCodes = [...rows, duplicate];

    const analysis = await analysePackage(read.result, DEFAULT_POLICIES, {
      createMissingReferences: false,
      restoreDeleted: false,
    });

    expect(analysis.canImport).toBe(false);
    expect(
      analysis.errors.some((error) => error.code === "customer_transfer.conflict"),
    ).toBe(true);
    expect(
      analysis.plan.get("EquipmentQrCode:ct-qr-duplicate")?.action,
    ).toBe("CONFLICT");
  });

  it("blokkerer en ekstern QR-kode som allerede finnes på en annen enhet", async () => {
    const read = readPackage(packageBuffer);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const [code] = read.result.dataset.equipmentQrCodes;
    const otherProduct = read.result.dataset.products.find(
      (product) => product.id !== code.productId,
    );
    expect(otherProduct).toBeTruthy();
    if (!otherProduct) return;
    read.result.dataset.equipmentQrCodes = [
      { ...code, id: "ct-qr-other-asset", productId: otherProduct.id },
    ];

    const analysis = await analysePackage(read.result, DEFAULT_POLICIES, {
      createMissingReferences: false,
      restoreDeleted: false,
    });

    expect(analysis.canImport).toBe(false);
    expect(
      analysis.errors.some((error) => error.code === "customer_transfer.conflict"),
    ).toBe(true);
    expect(
      analysis.plan.get("EquipmentQrCode:ct-qr-other-asset")?.action,
    ).toBe("CONFLICT");
  });

  it("rydder utløpte staging-kataloger", async () => {
    const expired = await createTransferJob({
      actorId: ids.adminId,
      kind: "EXPORT",
      status: "READY",
      expiresAt: new Date(Date.now() - 60_000),
    });
    await writeStagedPackage(expired.id, Buffer.from("expired"));
    const removed = await cleanupExpiredTransfers();
    expect(removed).toBeGreaterThanOrEqual(1);
    const after = await prisma.customerTransferJob.findUnique({
      where: { id: expired.id },
    });
    expect(after?.status).toBe("EXPIRED");
  });
});

async function deleteCustomerDossier(customerId: string): Promise<number> {
  const orders = await prisma.workOrder.findMany({
    where: { customerId },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  await prisma.report.deleteMany({ where: { workOrderId: { in: orderIds } } });
  await prisma.visit.deleteMany({ where: { workOrderId: { in: orderIds } } });
  await prisma.comment.deleteMany({ where: { customerId } });
  await prisma.workOrder.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.contract.deleteMany({ where: { customerId } });
  await prisma.maintenancePlan.deleteMany({ where: { customerId } });
  await prisma.meterReading.deleteMany({ where: { product: { customerId } } });
  await prisma.document.deleteMany({ where: { customerId } });
  await prisma.upload.deleteMany({ where: { customerId } });
  await prisma.customerAttachment.deleteMany({ where: { customerId } });
  await prisma.portalDelegation.deleteMany({
    where: { contact: { customerId } },
  });
  await prisma.contact.deleteMany({ where: { customerId } });
  await prisma.customerSite.deleteMany({ where: { customerId } });
  await prisma.user.deleteMany({ where: { customerId } });
  await prisma.product.deleteMany({ where: { customerId } });
  const deleted = await prisma.customer.deleteMany({ where: { id: customerId } });
  return deleted.count;
}

