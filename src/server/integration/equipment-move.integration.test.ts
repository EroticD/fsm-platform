import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { addDaysUtc, todayUtc } from "@/lib/dates";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";
import { listEquipment } from "@/server/equipment";
import {
  getEquipmentMovePreview,
  moveEquipmentToCustomer,
} from "@/server/equipment-move";

const describeIntegration = integrationEnabled ? describe : describe.skip;

function actor(input: {
  id: string;
  role: string;
  departmentId: string | null;
  permissions: string[];
  customerId?: string | null;
}): ServiceActor {
  return {
    id: input.id,
    name: input.role === "ADMIN" ? "Testadmin" : "Testkontor",
    email: `${input.id}@example.test`,
    role: input.role,
    isActive: true,
    departmentId: input.departmentId,
    customerId: input.customerId ?? null,
    permissions: input.permissions,
    permissionsCustomized: true,
    roleDefinition: null,
  };
}

describeIntegration("Flytting av utstyr til annen kunde", () => {
  let tempRoot = "";
  let departmentAId = "";
  let departmentBId = "";
  let departmentCId = "";
  let customerAId = "";
  let customerBId = "";
  let customerCId = "";
  let siteAId = "";
  let siteBId = "";
  let parentId = "";
  let rootId = "";
  let childId = "";
  let grandchildId = "";
  let rootQrToken = "";
  let rootQrCodeId = "";
  let workOrderRootId = "";
  let workOrderChildId = "";
  let reportRootId = "";
  let planRootId = "";
  let documentRootId = "";
  let pdfStoredName = "";
  let documentStoredName = "";
  let concurrencyProductId = "";
  let staleProductId = "";
  let contractBlockedProductId = "";
  let siteMismatchProductId = "";
  let admin: ServiceActor;
  let office: ServiceActor;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-move-unit-"));
    process.env.UPLOAD_DIR = tempRoot;

    const depA = await prisma.department.create({
      data: { name: unique("Flytt-A") },
    });
    const depB = await prisma.department.create({
      data: { name: unique("Flytt-B") },
    });
    const depC = await prisma.department.create({
      data: { name: unique("Flytt-C") },
    });
    departmentAId = depA.id;
    departmentBId = depB.id;
    departmentCId = depC.id;

    const customerA = await prisma.customer.create({
      data: { name: unique("Flytt-kunde-A"), departmentId: depA.id },
    });
    const customerB = await prisma.customer.create({
      data: { name: unique("Flytt-kunde-B"), departmentId: depB.id },
    });
    const customerC = await prisma.customer.create({
      data: { name: unique("Flytt-kunde-C"), departmentId: depC.id },
    });
    customerAId = customerA.id;
    customerBId = customerB.id;
    customerCId = customerC.id;

    const siteA = await prisma.customerSite.create({
      data: {
        customerId: customerA.id,
        name: unique("Sted-A"),
        address: "Gammelgate 1",
        city: "Oslo",
        isPrimary: true,
      },
    });
    const siteB = await prisma.customerSite.create({
      data: {
        customerId: customerB.id,
        name: unique("Sted-B"),
        address: "Nyveien 2",
        city: "Bergen",
        isPrimary: true,
      },
    });
    siteAId = siteA.id;
    siteBId = siteB.id;

    const parent = await prisma.product.create({
      data: { customerId: customerA.id, model: "Forelder som blir igjen" },
    });
    const root = await prisma.product.create({
      data: {
        customerId: customerA.id,
        model: "Rotpumpe",
        serialNumber: unique("SN-ROT"),
        siteId: siteA.id,
        parentId: parent.id,
        qrToken: randomUUID().replace(/-/g, ""),
      },
    });
    const child = await prisma.product.create({
      data: {
        customerId: customerA.id,
        model: "Underpumpe",
        serialNumber: unique("SN-BARN"),
        siteId: siteA.id,
        parentId: root.id,
        qrToken: randomUUID().replace(/-/g, ""),
      },
    });
    const grandchild = await prisma.product.create({
      data: {
        customerId: customerA.id,
        model: "Under-underpumpe",
        serialNumber: unique("SN-BARN-BARN"),
        siteId: siteA.id,
        parentId: child.id,
      },
    });
    parentId = parent.id;
    rootId = root.id;
    childId = child.id;
    grandchildId = grandchild.id;
    rootQrToken = root.qrToken!;

    const qrCode = await prisma.equipmentQrCode.create({
      data: {
        productId: root.id,
        value: unique("LEGACY-ROT"),
        normalizedValue: unique("LEGACY-ROT-N"),
        label: "Fysisk etikett",
        source: "MANUAL",
      },
    });
    rootQrCodeId = qrCode.id;

    const contactA = await prisma.contact.create({
      data: { name: "Gammel kontakt", customerId: customerA.id },
    });

    const contractLink = await prisma.contract.create({
      data: {
        title: unique("Gammel avtale uten linjer"),
        intervalMonths: 12,
        startDate: todayUtc(),
        nextServiceDate: todayUtc(),
        customerId: customerA.id,
        departmentId: depA.id,
      },
    });

    const workOrderRoot = await prisma.workOrder.create({
      data: {
        title: "Service rot",
        reference: unique("O-MOVE-ROT"),
        customerId: customerA.id,
        siteId: siteA.id,
        departmentId: depA.id,
        productId: root.id,
        contactId: contactA.id,
        contractId: contractLink.id,
        orderNumberNormalized: unique("ROT-ORDRE"),
        scheduledFor: todayUtc(),
      },
    });
    const workOrderChild = await prisma.workOrder.create({
      data: {
        title: "Service barn",
        reference: unique("O-MOVE-BARN"),
        customerId: customerA.id,
        siteId: siteA.id,
        departmentId: depA.id,
        productId: child.id,
        orderNumberNormalized: unique("BARN-ORDRE"),
        scheduledFor: todayUtc(),
      },
    });
    workOrderRootId = workOrderRoot.id;
    workOrderChildId = workOrderChild.id;

    const start = new Date("2026-11-01T09:00:00.000Z");
    await prisma.visit.createMany({
      data: [
        {
          workOrderId: workOrderRoot.id,
          sequence: 0,
          startsAt: start,
          endsAt: new Date(start.getTime() + 60 * 60 * 1000),
        },
        {
          workOrderId: workOrderChild.id,
          sequence: 0,
          startsAt: start,
          endsAt: new Date(start.getTime() + 60 * 60 * 1000),
        },
      ],
    });

    pdfStoredName = `${randomUUID()}.pdf`;
    await fs.writeFile(
      path.join(tempRoot, pdfStoredName),
      "%PDF-1.4\n% testrapport\n%%EOF\n",
    );
    const pdfUrl = `/uploads/${pdfStoredName}`;

    const reportRoot = await prisma.report.create({
      data: {
        dataJson: "{}",
        workOrderId: workOrderRoot.id,
        name: "Servicerapport rot",
        pdfUrl,
        pdfHash: "hash-rootes",
      },
    });
    const reportChild = await prisma.report.create({
      data: {
        dataJson: "{}",
        workOrderId: workOrderChild.id,
        name: "Servicerapport barn",
      },
    });
    reportRootId = reportRoot.id;

    await prisma.reportRevision.create({
      data: {
        reportId: reportRoot.id,
        revision: 1,
        dataJson: "{}",
        unitsJson: "[]",
        reason: "Testrevisjon",
      },
    });
    await prisma.reportUnit.create({
      data: { reportId: reportRoot.id, productId: root.id, label: "Rotpumpe" },
    });
    await prisma.reportUnit.create({
      data: { reportId: reportChild.id, productId: child.id, label: "Underpumpe" },
    });

    const planRoot = await prisma.maintenancePlan.create({
      data: {
        title: "Årlig rot",
        trigger: "CALENDAR",
        intervalMonths: 12,
        customerId: customerA.id,
        departmentId: depA.id,
        productId: root.id,
        nextDueDate: todayUtc(),
      },
    });
    planRootId = planRoot.id;
    await prisma.maintenancePlan.create({
      data: {
        title: "Årlig barn",
        trigger: "CALENDAR",
        intervalMonths: 12,
        customerId: customerA.id,
        departmentId: depA.id,
        productId: child.id,
        nextDueDate: addDaysUtc(todayUtc(), 30),
      },
    });
    await prisma.maintenancePlanOccurrence.create({
      data: {
        planId: planRoot.id,
        dueDate: todayUtc(),
        status: "GENERATED",
        workOrderId: workOrderRoot.id,
      },
    });

    await prisma.meterReading.createMany({
      data: [
        { productId: root.id, value: 100, readAt: todayUtc(), source: "MANUAL" },
        { productId: root.id, value: 110, readAt: todayUtc(), source: "MANUAL" },
        { productId: child.id, value: 5, readAt: todayUtc(), source: "MANUAL" },
      ],
    });

    documentStoredName = `${randomUUID()}.pdf`;
    await fs.writeFile(
      path.join(tempRoot, documentStoredName),
      "%PDF-1.4\n% testdokument\n%%EOF\n",
    );
    const documentRoot = await prisma.document.create({
      data: {
        title: "Dokument rot",
        fileName: "rot.pdf",
        filePath: `/uploads/${documentStoredName}`,
        fileSize: 20,
        customerId: customerA.id,
        productId: root.id,
      },
    });
    const documentChild = await prisma.document.create({
      data: {
        title: "Dokument barn",
        fileName: "barn.pdf",
        filePath: `/uploads/${documentStoredName}`,
        fileSize: 20,
        customerId: customerA.id,
        productId: child.id,
      },
    });
    documentRootId = documentRoot.id;
    await prisma.documentVersion.createMany({
      data: [
        {
          documentId: documentRoot.id,
          fileName: "rot-gammel.pdf",
          filePath: `/uploads/${documentStoredName}`,
          fileSize: 20,
        },
        {
          documentId: documentChild.id,
          fileName: "barn-gammel.pdf",
          filePath: `/uploads/${documentStoredName}`,
          fileSize: 20,
        },
      ],
    });

    const pdfUpload = await prisma.upload.create({
      data: {
        storedName: pdfStoredName,
        originalName: "Servicerapport rot.pdf",
        mimeType: "application/pdf",
        size: 20,
        ownerType: "WORK_ORDER",
        ownerId: workOrderRoot.id,
        departmentId: depA.id,
        customerId: customerA.id,
      },
    });
    expect(pdfUpload.id).toBeTruthy();
    await prisma.upload.create({
      data: {
        storedName: `${randomUUID()}.png`,
        originalName: "utstyr.png",
        mimeType: "image/png",
        size: 12,
        ownerType: "EQUIPMENT",
        ownerId: root.id,
        departmentId: depA.id,
        customerId: customerA.id,
      },
    });
    await prisma.upload.create({
      data: {
        storedName: documentStoredName,
        originalName: "Dokument rot.pdf",
        mimeType: "application/pdf",
        size: 20,
        ownerType: "DOCUMENT",
        ownerId: documentRoot.id,
        departmentId: depA.id,
        customerId: customerA.id,
      },
    });

    await prisma.comment.create({
      data: {
        content: "Gammel kommentar",
        workOrderId: workOrderRoot.id,
        customerId: customerA.id,
        contactId: contactA.id,
      },
    });

    const concurrencyProduct = await prisma.product.create({
      data: { customerId: customerA.id, model: "Samtidighetsenhet" },
    });
    concurrencyProductId = concurrencyProduct.id;

    const staleProduct = await prisma.product.create({
      data: { customerId: customerA.id, model: "Utdatert forhåndsvisning" },
    });
    staleProductId = staleProduct.id;

    const contractBlockedProduct = await prisma.product.create({
      data: { customerId: customerA.id, model: "Kontraktsperret enhet" },
    });
    contractBlockedProductId = contractBlockedProduct.id;
    const blockingContract = await prisma.contract.create({
      data: {
        title: unique("Aktiv serviceavtale"),
        intervalMonths: 12,
        startDate: todayUtc(),
        nextServiceDate: todayUtc(),
        customerId: customerA.id,
        departmentId: depA.id,
      },
    });
    await prisma.contractLine.create({
      data: {
        contractId: blockingContract.id,
        productId: contractBlockedProduct.id,
        scope: "Enhet",
      },
    });

    const siteMismatchProduct = await prisma.product.create({
      data: {
        customerId: customerA.id,
        model: "Feil sted-enhet",
        siteId: siteA.id,
      },
    });
    siteMismatchProductId = siteMismatchProduct.id;

    admin = actor({
      id: "move-admin",
      role: "ADMIN",
      departmentId: depA.id,
      permissions: [],
    });
    office = actor({
      id: "move-office",
      role: "OFFICE",
      departmentId: depA.id,
      permissions: [
        "equipment.view",
        "equipment.manage",
        "customers.view",
        "customers.manage",
        "workorders.view",
        "reports.view",
        "documents.view",
      ],
    });
  });

  afterAll(async () => {
    const customerIds = [customerAId, customerBId, customerCId];
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [rootId, concurrencyProductId, staleProductId] } },
    });
    await prisma.upload.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.document.deleteMany({
      where: { OR: [{ customerId: { in: customerIds } }, { productId: { in: [rootId, childId, grandchildId] } }] },
    });
    await prisma.workOrder.deleteMany({
      where: {
        OR: [
          { customerId: { in: customerIds } },
          { productId: { in: [rootId, childId, grandchildId] } },
        ],
      },
    });
    await prisma.maintenancePlan.deleteMany({
      where: { customerId: { in: customerIds } },
    });
    await prisma.contract.deleteMany({
      where: { customerId: { in: customerIds } },
    });
    await prisma.product.deleteMany({
      where: {
        OR: [
          { customerId: { in: customerIds } },
          { id: { in: [rootId, childId, grandchildId, parentId] } },
        ],
      },
    });
    await prisma.customerSite.deleteMany({
      where: { customerId: { in: customerIds } },
    });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.department.deleteMany({
      where: { id: { in: [departmentAId, departmentBId, departmentCId] } },
    });
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("forhåndsviser hele undertreet med etterprøvbare antall", async () => {
    const preview = await getEquipmentMovePreview(
      office,
      rootId,
      customerBId,
      siteBId,
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.data.noop).toBe(false);
    expect(preview.data.canMove).toBe(true);
    expect(preview.data.blockers).toEqual([]);
    expect(preview.data.counts).toMatchObject({
      products: 3,
      workOrders: 2,
      visits: 2,
      reports: 2,
      reportRevisions: 1,
      reportUnits: 2,
      meterReadings: 3,
      plans: 2,
      planOccurrences: 1,
      documents: 2,
      documentVersions: 2,
      uploads: 3,
      qrCodes: 1,
      comments: 1,
    });
    expect(preview.data.previewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.data.warnings.map((warning) => warning.code)).toContain(
      "workOrderContractCleared",
    );
  });

  it("flytter produktundertreet og all historikk i én transaksjon", async () => {
    const preview = await getEquipmentMovePreview(
      office,
      rootId,
      customerBId,
      siteBId,
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await moveEquipmentToCustomer(
      office,
      rootId,
      customerBId,
      siteBId,
      { previewHash: preview.data.previewHash },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.noop).toBe(false);
    expect(result.data.counts.products).toBe(3);

    const products = await prisma.product.findMany({
      where: { id: { in: [rootId, childId, grandchildId, parentId] } },
      select: {
        id: true,
        customerId: true,
        parentId: true,
        siteId: true,
        qrToken: true,
      },
      orderBy: { id: "asc" },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    expect(byId.get(rootId)).toMatchObject({
      customerId: customerBId,
      parentId: null,
      siteId: siteBId,
      qrToken: rootQrToken,
    });
    expect(byId.get(childId)).toMatchObject({
      customerId: customerBId,
      parentId: rootId,
      siteId: null,
    });
    expect(byId.get(grandchildId)).toMatchObject({
      customerId: customerBId,
      parentId: childId,
      siteId: null,
    });
    expect(byId.get(parentId)).toMatchObject({
      customerId: customerAId,
    });

    const workOrders = await prisma.workOrder.findMany({
      where: { id: { in: [workOrderRootId, workOrderChildId] } },
      select: {
        id: true,
        customerId: true,
        siteId: true,
        departmentId: true,
        contactId: true,
        contractId: true,
      },
    });
    expect(workOrders).toHaveLength(2);
    for (const order of workOrders) {
      expect(order).toMatchObject({
        customerId: customerBId,
        siteId: siteBId,
        departmentId: departmentBId,
        contactId: null,
      });
    }
    expect(
      workOrders.find((order) => order.id === workOrderRootId)?.contractId,
    ).toBeNull();

    const reports = await prisma.report.findMany({
      where: { id: { in: [reportRootId] } },
      select: { id: true, workOrderId: true, pdfUrl: true, dataJson: true },
    });
    expect(reports).toEqual([
      expect.objectContaining({
        id: reportRootId,
        workOrderId: workOrderRootId,
        pdfUrl: `/uploads/${pdfStoredName}`,
      }),
    ]);
    await expect(
      fs.readFile(path.join(tempRoot, pdfStoredName), "utf8"),
    ).resolves.toContain("testrapport");

    const reportUnits = await prisma.reportUnit.findMany({
      where: { productId: { in: [rootId, childId] } },
      select: { productId: true },
    });
    expect(reportUnits).toHaveLength(2);

    const plans = await prisma.maintenancePlan.findMany({
      where: { productId: { in: [rootId, childId] } },
      select: { customerId: true, departmentId: true },
    });
    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      expect(plan).toEqual({
        customerId: customerBId,
        departmentId: departmentBId,
      });
    }
    const occurrences = await prisma.maintenancePlanOccurrence.count({
      where: { planId: planRootId },
    });
    expect(occurrences).toBe(1);

    const documents = await prisma.document.findMany({
      where: { id: { in: [documentRootId] } },
      select: { customerId: true, productId: true, filePath: true },
    });
    expect(documents).toEqual([
      {
        customerId: customerBId,
        productId: rootId,
        filePath: `/uploads/${documentStoredName}`,
      },
    ]);
    await expect(
      fs.readFile(path.join(tempRoot, documentStoredName), "utf8"),
    ).resolves.toContain("testdokument");

    const uploads = await prisma.upload.findMany({
      where: {
        OR: [
          { ownerType: "WORK_ORDER", ownerId: workOrderRootId },
          { ownerType: "EQUIPMENT", ownerId: rootId },
          { ownerType: "DOCUMENT", ownerId: documentRootId },
        ],
      },
      select: { id: true, customerId: true, departmentId: true },
    });
    expect(uploads).toHaveLength(3);
    for (const upload of uploads) {
      expect(upload).toEqual({
        id: upload.id,
        customerId: customerBId,
        departmentId: departmentBId,
      });
    }

    const qrCode = await prisma.equipmentQrCode.findUnique({
      where: { id: rootQrCodeId },
      select: { productId: true, value: true },
    });
    expect(qrCode?.productId).toBe(rootId);
    expect(qrCode?.value).toBeTruthy();

    const comment = await prisma.comment.findFirst({
      where: { workOrderId: workOrderRootId },
      select: { customerId: true, contactId: true },
    });
    expect(comment).toEqual({ customerId: customerBId, contactId: null });

    const auditRow = await prisma.auditLog.findFirst({
      where: {
        entityType: "Product",
        entityId: rootId,
        action: "Flyttet utstyr til annen kunde",
      },
      orderBy: { seq: "desc" },
      select: { metadata: true, departmentId: true },
    });
    expect(auditRow?.metadata).toMatchObject({
      sourceCustomerId: customerAId,
      targetCustomerId: customerBId,
      targetSiteId: siteBId,
      counts: { products: 3, workOrders: 2, reports: 2 },
    });
  });

  it("gir gammel kunde ingen av de flyttede enhetene og ny kunde alle", async () => {
    const oldCustomer = actor({
      id: "move-old-customer",
      role: "CUSTOMER",
      departmentId: null,
      permissions: ["equipment.view"],
      customerId: customerAId,
    });
    const newCustomer = actor({
      id: "move-new-customer",
      role: "CUSTOMER",
      departmentId: null,
      permissions: ["equipment.view"],
      customerId: customerBId,
    });

    const oldEquipment = await listEquipment(oldCustomer, { limit: 100 });
    const newEquipment = await listEquipment(newCustomer, { limit: 100 });
    expect(oldEquipment.ok).toBe(true);
    expect(newEquipment.ok).toBe(true);
    if (!oldEquipment.ok || !newEquipment.ok) return;

    expect(oldEquipment.data.items.map((item) => item.id)).toContain(parentId);
    expect(oldEquipment.data.items.map((item) => item.id)).not.toEqual(
      expect.arrayContaining([rootId, childId, grandchildId]),
    );
    expect(newEquipment.data.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([rootId, childId, grandchildId]),
    );
    expect(
      await prisma.workOrder.count({ where: { productId: rootId, customerId: customerAId } }),
    ).toBe(0);
    expect(
      await prisma.workOrder.count({ where: { productId: rootId, customerId: customerBId } }),
    ).toBe(1);
  });

  it("er idempotent og returnerer et tydelig no-op ved andre identiske kall", async () => {
    const result = await moveEquipmentToCustomer(
      office,
      rootId,
      customerBId,
      siteBId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.noop).toBe(true);
    expect(result.data.canMove).toBe(false);

    expect(
      await prisma.auditLog.count({
        where: {
          entityId: rootId,
          action: "Flyttet utstyr til annen kunde",
        },
      }),
    ).toBe(1);
  });

  it("serialiserer samtidige flyttinger og skriver bare ett revisjonsspor", async () => {
    const results = await Promise.all([
      moveEquipmentToCustomer(office, concurrencyProductId, customerBId),
      moveEquipmentToCustomer(office, concurrencyProductId, customerBId),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const successful = results.flatMap((result) =>
      result.ok ? [result.data] : [],
    );
    expect(successful.filter((data) => !data.noop)).toHaveLength(1);
    expect(successful.filter((data) => data.noop)).toHaveLength(1);

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: concurrencyProductId },
      select: { customerId: true },
    });
    expect(product.customerId).toBe(customerBId);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: concurrencyProductId,
          action: "Flyttet utstyr til annen kunde",
        },
      }),
    ).toBe(1);
  });

  it("avviser utdatert forhåndsvisning når målet er endret", async () => {
    const preview = await getEquipmentMovePreview(
      office,
      staleProductId,
      customerBId,
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await moveEquipmentToCustomer(
      office,
      staleProductId,
      customerCId,
      null,
      { previewHash: preview.data.previewHash },
    );
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "equipment.errors.stalePreview" },
    });

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: staleProductId },
      select: { customerId: true },
    });
    expect(product.customerId).toBe(customerAId);
  });

  it("avviser et sted som tilhører en annen kunde", async () => {
    const preview = await getEquipmentMovePreview(
      office,
      siteMismatchProductId,
      customerBId,
      siteAId,
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.canMove).toBe(false);
    expect(preview.data.blockers).toContainEqual({
      code: "targetSiteMismatch",
    });

    const move = await moveEquipmentToCustomer(
      office,
      siteMismatchProductId,
      customerBId,
      siteAId,
    );
    expect(move).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "equipment.errors.targetSiteMismatch" },
    });
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: siteMismatchProductId },
      select: { customerId: true },
    });
    expect(product.customerId).toBe(customerAId);
  });

  it("blokkerer flytting når en kontraktlinje peker på enheten", async () => {
    const preview = await getEquipmentMovePreview(
      office,
      contractBlockedProductId,
      customerBId,
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.canMove).toBe(false);
    expect(preview.data.blockers).toContainEqual({
      code: "contractBlocked",
      count: 1,
    });

    const move = await moveEquipmentToCustomer(
      office,
      contractBlockedProductId,
      customerBId,
    );
    expect(move).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "equipment.errors.contractBlocked" },
    });
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: contractBlockedProductId },
      select: { customerId: true },
    });
    expect(product.customerId).toBe(customerAId);
  });

  it("nekter aktører uten både equipment.manage og customers.manage", async () => {
    const technician = actor({
      id: "move-technician",
      role: "TECHNICIAN",
      departmentId: departmentAId,
      permissions: ["equipment.view", "equipment.manage"],
    });
    const preview = await getEquipmentMovePreview(
      technician,
      rootId,
      customerBId,
    );
    expect(preview).toMatchObject({ ok: false, reason: "forbidden" });

    const move = await moveEquipmentToCustomer(
      technician,
      rootId,
      customerBId,
    );
    expect(move).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("beskytter gamle revisjonsrader og lar admin se hele flyttingen", async () => {
    const oldAudit = await prisma.auditLog.findFirst({
      where: { entityType: "Product", entityId: parentId },
      orderBy: { seq: "desc" },
      select: { seq: true, metadata: true },
    });
    // Forelderen ble aldri flyttet, så det skal ikke finnes en flyttehendelse.
    expect(oldAudit).toBeNull();

    const preview = await getEquipmentMovePreview(admin, rootId, customerBId, siteBId);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.noop).toBe(true);
    expect(preview.data.counts.products).toBe(3);
  });
});
