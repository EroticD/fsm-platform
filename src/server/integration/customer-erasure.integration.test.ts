import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";
import {
  eraseCustomerData,
  erasureBlockersFromDetails,
  getCustomerErasurePreview,
} from "@/server/customer-erasure";

const describeIntegration = integrationEnabled ? describe : describe.skip;

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

let root = "";
let previousUploadDir: string | undefined;
let departmentId = "";
const trackedCustomerIds: string[] = [];
const trackedEntityIds: string[] = [];
const trackedStaffUserIds: string[] = [];

const admin: ServiceActor = {
  id: "gdpr-admin",
  name: "GDPR Administrator",
  email: "gdpr-admin@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: null,
  permissionsCustomized: false,
  permissions: [],
  roleDefinition: null,
};

function actor(role: string, isActive = true): ServiceActor {
  return {
    id: `gdpr-${role}-${isActive ? "active" : "inactive"}`,
    name: `GDPR ${role}`,
    email: null,
    role,
    isActive,
    departmentId,
    permissions: role === "OFFICE" ? ["customers.manage"] : [],
    permissionsCustomized: role !== "ADMIN",
    roleDefinition: null,
  };
}

async function writeUpload(storedName: string, content: string) {
  await fs.mkdir(root, { recursive: true });
  const filePath = path.join(root, storedName);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function uploadRow(input: {
  storedName: string;
  originalName: string;
  ownerType: string;
  ownerId: string | null;
  customerId: string;
  departmentId: string;
}) {
  await writeUpload(input.storedName, input.storedName);
  return prisma.upload.create({
    data: {
      storedName: input.storedName,
      originalName: input.originalName,
      mimeType: "application/pdf",
      size: input.storedName.length,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      departmentId: input.departmentId,
      customerId: input.customerId,
      uploadedById: null,
    },
  });
}

async function seedFixture(options?: {
  orderLegalHold?: boolean;
  reportLegalHold?: boolean;
}) {
  const customerName = unique("Kunde Personvern");
  const email = `${unique("kunde")}@example.test`;
  const responsibleTechnician = await prisma.user.create({
    data: {
      name: "Ansvarlig Montør",
      email: `${unique("ansvarlig")}@example.test`,
      role: "TECHNICIAN",
      isActive: true,
      departmentId,
    },
  });
  trackedStaffUserIds.push(responsibleTechnician.id);
  const customer = await prisma.customer.create({
    data: {
      name: customerName,
      customerNumber: unique("K"),
      orgNumber: "998 877 665",
      brandColor: "#123456",
      address: "Personvernvegen 1",
      postalCode: "6001",
      city: "Ålesund",
      phone: "99887766",
      email,
      notes: `Notat om ${customerName}`,
      departmentId,
      responsibleTechnicianId: responsibleTechnician.id,
      logoUrl: null,
    },
  });
  trackedCustomerIds.push(customer.id);
  trackedEntityIds.push(customer.id);

  const logo = await uploadRow({
    storedName: `${unique("logo")}.png`,
    originalName: "kundelogo.png",
    ownerType: "CUSTOMER",
    ownerId: customer.id,
    customerId: customer.id,
    departmentId,
  });
  await prisma.customer.update({
    where: { id: customer.id },
    data: { logoUrl: `/uploads/${logo.storedName}` },
  });

  const contact = await prisma.contact.create({
    data: {
      customerId: customer.id,
      name: `Kontakt ${customerName}`,
      email: `${unique("kontakt")}@example.test`,
      phone: "91234567",
      role: "Driftsjef",
      locale: "nb",
    },
  });
  trackedEntityIds.push(contact.id);
  await prisma.portalDelegation.create({
    data: {
      contactId: contact.id,
      canBook: true,
      canViewDocuments: true,
      canViewContracts: true,
      canViewEquipment: true,
      isActive: true,
    },
  });

  const portalUser = await prisma.user.create({
    data: {
      name: `Portal ${customerName}`,
      email: `${unique("portal")}@example.test`,
      phone: "97654321",
      role: "CUSTOMER",
      isActive: true,
      customerId: customer.id,
      contactId: contact.id,
      password: "$2b$10$hash",
      emailVerified: new Date(),
      twoFactorSecret: "hemmelighet",
      isTwoFactorEnabled: true,
      sessionVersion: 3,
    },
  });
  trackedEntityIds.push(portalUser.id);

  const site = await prisma.customerSite.create({
    data: {
      customerId: customer.id,
      name: `Anlegg ${customerName}`,
      address: "Anleggsvegen 2",
      postalCode: "6002",
      city: "Ålesund",
      latitude: 62.47,
      longitude: 6.15,
      isPrimary: true,
    },
  });
  trackedEntityIds.push(site.id);

  const product = await prisma.product.create({
    data: {
      customerId: customer.id,
      model: "Pumpe X",
      serialNumber: unique("SN"),
      location: `Anlegg ${customerName}`,
      status: "ACTIVE",
      criticality: 2,
    },
  });
  trackedEntityIds.push(product.id);

  const workOrder = await prisma.workOrder.create({
    data: {
      title: `Service ${customerName}`,
      reference: unique("O"),
      description: `Adresse ${customerName}, ${email}`,
      orderNumber: unique("ORD"),
      orderNumberNormalized: unique("ord"),
      address: "Personvernvegen 1",
      postalCode: "6001",
      city: "Ålesund",
      latitude: 62.47,
      longitude: 6.15,
      geoAddressHash: "hash",
      scheduledFor: new Date("2026-11-10"),
      status: "COMPLETED",
      creatorName: customerName,
      departmentId,
      customerId: customer.id,
      siteId: site.id,
      contactId: contact.id,
      legalHold: options?.orderLegalHold ?? false,
    },
  });
  trackedEntityIds.push(workOrder.id);

  const reportPdfStored = `${unique("rapport")}.pdf`;
  const customerSignatureStored = `${unique("kundesignatur")}.png`;
  const technicianSignatureStored = `${unique("teknikersignatur")}.png`;
  await uploadRow({
    storedName: reportPdfStored,
    originalName: `rapport-${customerName}.pdf`,
    ownerType: "WORK_ORDER",
    ownerId: workOrder.id,
    customerId: customer.id,
    departmentId,
  });
  await uploadRow({
    storedName: customerSignatureStored,
    originalName: `signatur-${customerName}.png`,
    ownerType: "WORK_ORDER",
    ownerId: workOrder.id,
    customerId: customer.id,
    departmentId,
  });
  await uploadRow({
    storedName: technicianSignatureStored,
    originalName: "tekniker.png",
    ownerType: "WORK_ORDER",
    ownerId: workOrder.id,
    customerId: customer.id,
    departmentId,
  });

  const report = await prisma.report.create({
    data: {
      dataJson: JSON.stringify({
        status: "GODKJENT",
        answers: { customerName, contact: email },
        customerName,
      }),
      comments: `Kunde ${customerName} var til stede. E-post ${email}.`,
      workOrderId: workOrder.id,
      templateTitle: "Service",
      name: "Service",
      reportNumber: unique("R"),
      isLocked: true,
      lockedAt: new Date("2026-11-10"),
      lockedByName: "Administrator",
      customerSignatureUrl: `/uploads/${customerSignatureStored}`,
      technicianSignatureUrl: `/uploads/${technicianSignatureStored}`,
      technicianName: "Tekniker",
      customerName,
      customerAcknowledgedAt: new Date("2026-11-10"),
      customerAcknowledgedBy: customerName,
      customerAcknowledgedComment: `Takk ${customerName}`,
      pdfUrl: `/uploads/${reportPdfStored}`,
      pdfHash: "pdf-hash",
      pdfGeneratedAt: new Date("2026-11-10"),
      legalHold: options?.reportLegalHold ?? false,
    },
  });
  trackedEntityIds.push(report.id);

  await prisma.reportRevision.create({
    data: {
      reportId: report.id,
      revision: 0,
      dataJson: JSON.stringify({ customerName, email }),
      unitsJson: JSON.stringify([{ label: customerName, answersJson: "{}" }]),
      comments: `Kunde ${customerName}`,
      customerName,
      customerSignatureUrl: `/uploads/${customerSignatureStored}`,
      technicianName: "Tekniker",
      customerAcknowledgedBy: customerName,
      customerAcknowledgedComment: `Kvittering ${customerName}`,
    },
  });
  await prisma.reportUnit.create({
    data: {
      reportId: report.id,
      label: customerName,
      serialNumber: "SN-1",
      location: `Anlegg ${customerName}`,
      status: "GODKJENT",
      answersJson: JSON.stringify({
        note: `Kontakt ${customerName}`,
        customerName,
        email,
      }),
      comment: `Alt ok for ${customerName}`,
      sortOrder: 0,
    },
  });

  await prisma.reportDraft.create({
    data: {
      workOrderId: workOrder.id,
      templateId: unique("mal"),
      userId: portalUser.id,
      dataJson: JSON.stringify({
        notes: `Kladd for ${customerName}`,
        customerSignatureUrl: `/uploads/${customerSignatureStored}`,
      }),
      updatedByName: customerName,
    },
  });

  const customerAttachmentStored = `${unique("kundevedlegg")}.pdf`;
  await uploadRow({
    storedName: customerAttachmentStored,
    originalName: `avtale-${customerName}.pdf`,
    ownerType: "CUSTOMER",
    ownerId: customer.id,
    customerId: customer.id,
    departmentId,
  });
  const customerAttachment = await prisma.customerAttachment.create({
    data: {
      customerId: customer.id,
      fileName: `avtale-${customerName}.pdf`,
      dataUrl: `/uploads/${customerAttachmentStored}`,
    },
  });
  trackedEntityIds.push(customerAttachment.id);

  const attachmentStored = `${unique("oppdragsvedlegg")}.pdf`;
  await uploadRow({
    storedName: attachmentStored,
    originalName: `bilde-${customerName}.pdf`,
    ownerType: "WORK_ORDER",
    ownerId: workOrder.id,
    customerId: customer.id,
    departmentId,
  });
  const attachment = await prisma.attachment.create({
    data: {
      workOrderId: workOrder.id,
      fileName: `bilde-${customerName}.pdf`,
      dataUrl: `/uploads/${attachmentStored}`,
    },
  });
  trackedEntityIds.push(attachment.id);

  const documentStored = `${unique("dokument")}.pdf`;
  const documentVersionStored = `${unique("dokumentv")}.pdf`;
  await uploadRow({
    storedName: documentStored,
    originalName: `dokument-${customerName}.pdf`,
    ownerType: "DOCUMENT",
    ownerId: null,
    customerId: customer.id,
    departmentId,
  });
  await uploadRow({
    storedName: documentVersionStored,
    originalName: `versjon-${customerName}.pdf`,
    ownerType: "DOCUMENT",
    ownerId: null,
    customerId: customer.id,
    departmentId,
  });
  const document = await prisma.document.create({
    data: {
      customerId: customer.id,
      title: `Dokument ${customerName}`,
      description: `Beskrivelse ${customerName}`,
      fileName: `dokument-${customerName}.pdf`,
      filePath: `/uploads/${documentStored}`,
      contentText: `Tekst med ${customerName}`,
      pageTexts: JSON.stringify([{ page: 1, text: customerName }]),
    },
  });
  trackedEntityIds.push(document.id);
  await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      fileName: `versjon-${customerName}.pdf`,
      filePath: `/uploads/${documentVersionStored}`,
    },
  });

  const booking = await prisma.bookingRequest.create({
    data: {
      reference: unique("B"),
      workOrderId: workOrder.id,
      customerId: customer.id,
      requestedDate: new Date("2026-11-10"),
      requestedFrom: "08:00",
      requestedTo: "10:00",
      siteId: site.id,
      equipmentLabel: `Pumpe hos ${customerName}`,
      contactName: customerName,
      contactPhone: "99887766",
      status: "CONFIRMED",
    },
  });
  trackedEntityIds.push(booking.id);
  await prisma.bookingRequestEvent.create({
    data: {
      bookingRequestId: booking.id,
      type: "CREATED",
      message: `Bestilt av ${customerName}`,
      actorName: customerName,
    },
  });

  const comment = await prisma.comment.create({
    data: {
      customerId: customer.id,
      workOrderId: workOrder.id,
      content: `Ring ${customerName} på 99887766.`,
      authorName: customerName,
    },
  });
  trackedEntityIds.push(comment.id);

  const thread = await prisma.messageThread.create({
    data: {
      threadKey: unique("thread"),
      customerId: customer.id,
      workOrderId: workOrder.id,
      contactId: contact.id,
      subject: `Samtale med ${customerName}`,
    },
  });
  trackedEntityIds.push(thread.id);
  await prisma.message.create({
    data: {
      threadId: thread.id,
      direction: "INBOUND",
      channel: "SMS",
      body: `Hei fra ${customerName}`,
      fromAddress: "99887766",
      toAddress: "90000000",
    },
  });
  await prisma.smsMessage.create({
    data: {
      to: "99887766",
      from: "90000000",
      body: `Hei ${customerName}`,
      status: "SENT",
      contactId: contact.id,
      workOrderId: workOrder.id,
      threadId: thread.id,
    },
  });

  const contract = await prisma.contract.create({
    data: {
      title: `Avtale ${customerName}`,
      contractNumber: unique("AV"),
      intervalMonths: 12,
      startDate: new Date("2026-01-01"),
      nextServiceDate: new Date("2027-01-01"),
      customerId: customer.id,
      departmentId,
      contactId: contact.id,
    },
  });
  trackedEntityIds.push(contract.id);

  await prisma.maintenancePlan.create({
    data: {
      title: `Plan ${customerName}`,
      trigger: "CALENDAR",
      intervalMonths: 12,
      customerId: customer.id,
      departmentId,
      productId: product.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      entityType: "Customer",
      entityId: customer.id,
      action: "Tidligere hendelse",
      userName: "Test",
    },
  });

  return {
    customerId: customer.id,
    customerName,
    customerEmail: email,
    contactId: contact.id,
    portalUserId: portalUser.id,
    siteId: site.id,
    productId: product.id,
    workOrderId: workOrder.id,
    reportId: report.id,
    reportPdfStored,
    customerSignatureStored,
    technicianSignatureStored,
    customerAttachmentStored,
    attachmentStored,
    documentStored,
    documentVersionStored,
    logoStored: logo.storedName,
    bookingId: booking.id,
    threadId: thread.id,
    commentId: comment.id,
  };
}

async function snapshot(fixture: Fixture) {
  const [
    customer,
    contacts,
    sites,
    portalUsers,
    workOrders,
    reports,
    revisions,
    units,
    attachments,
    customerAttachments,
    documents,
    uploads,
    audits,
  ] = await Promise.all([
    prisma.customer.findUnique({ where: { id: fixture.customerId } }),
    prisma.contact.findMany({ where: { customerId: fixture.customerId } }),
    prisma.customerSite.findMany({ where: { customerId: fixture.customerId } }),
    prisma.user.findMany({ where: { customerId: fixture.customerId } }),
    prisma.workOrder.findMany({ where: { customerId: fixture.customerId } }),
    prisma.report.findMany({
      where: { workOrder: { customerId: fixture.customerId } },
    }),
    prisma.reportRevision.findMany({
      where: { report: { workOrder: { customerId: fixture.customerId } } },
    }),
    prisma.reportUnit.findMany({
      where: { report: { workOrder: { customerId: fixture.customerId } } },
    }),
    prisma.attachment.findMany({
      where: { workOrder: { customerId: fixture.customerId } },
    }),
    prisma.customerAttachment.findMany({
      where: { customerId: fixture.customerId },
    }),
    prisma.document.findMany({ where: { customerId: fixture.customerId } }),
    prisma.upload.findMany({ where: { customerId: fixture.customerId } }),
    prisma.auditLog.findMany({
      where: { entityId: fixture.customerId },
      orderBy: { seq: "asc" },
    }),
  ]);
  const files = await Promise.all(
    [
      fixture.reportPdfStored,
      fixture.customerSignatureStored,
      fixture.technicianSignatureStored,
      fixture.customerAttachmentStored,
      fixture.attachmentStored,
      fixture.documentStored,
      fixture.documentVersionStored,
      fixture.logoStored,
    ].map(async (stored) => {
      try {
        await fs.access(path.join(root, stored));
        return [stored, true] as const;
      } catch {
        return [stored, false] as const;
      }
    }),
  );
  return {
    customer,
    contacts,
    sites,
    portalUsers,
    workOrders,
    reports,
    revisions,
    units,
    attachments,
    customerAttachments,
    documents,
    uploads,
    audits,
    files: Object.fromEntries(files),
  };
}

beforeAll(async () => {
  previousUploadDir = process.env.UPLOAD_DIR;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fsm-gdpr-erasure-"));
  process.env.UPLOAD_DIR = root;

  const department = await prisma.department.create({
    data: { name: unique("GDPR-avdeling") },
  });
  departmentId = department.id;
  admin.departmentId = departmentId;
});

afterAll(async () => {
  await prisma.auditHold.deleteMany({
    where: { entityId: { in: trackedEntityIds } },
  });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: trackedEntityIds } },
  });
  await prisma.user.deleteMany({
    where: { customerId: { in: trackedCustomerIds } },
  });
  await prisma.upload.deleteMany({
    where: { customerId: { in: trackedCustomerIds } },
  });
  for (const customerId of trackedCustomerIds) {
    await prisma.contract.deleteMany({ where: { customerId } });
    await prisma.maintenancePlan.deleteMany({ where: { customerId } });
    await prisma.workOrder.deleteMany({ where: { customerId } });
    await prisma.document.deleteMany({ where: { customerId } });
    await prisma.product.deleteMany({ where: { customerId } });
    await prisma.customerSite.deleteMany({ where: { customerId } });
    await prisma.contact.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
  }
  await prisma.user.deleteMany({ where: { id: { in: trackedStaffUserIds } } });
  await prisma.department.deleteMany({ where: { id: departmentId } });
  await fs.rm(root, { recursive: true, force: true });
  if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = previousUploadDir;
});

describeIntegration("GDPR-sletting av kunde", () => {
  it("anonymiserer direkte identifikatorer og bevarer tjenestehistorikk", async () => {
    const fixture = await seedFixture();
    const beforeAudit = await prisma.auditLog.count({
      where: { entityId: fixture.customerId },
    });

    const preview = await getCustomerErasurePreview(admin, fixture.customerId);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.alreadyAnonymised).toBe(false);
    expect(preview.data.blockers).toEqual([]);
    expect(preview.data.counts.workOrders).toBe(1);
    expect(preview.data.counts.reports).toBe(1);
    expect(preview.data.counts.portalUsers).toBe(1);

    const result = await eraseCustomerData(admin, fixture.customerId, {
      reason: `Personvernforespørsel fra ${fixture.customerName}`,
      confirmation: fixture.customerName,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.alreadyAnonymised).toBe(false);
    expect(result.data.reportPdfsRetained).toBe(1);

    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: fixture.customerId },
    });
    expect(customer.name).toBe(`Anonymisert kunde ${fixture.customerId.slice(-8)}`);
    expect(customer.customerNumber).toBeNull();
    expect(customer.orgNumber).toBeNull();
    expect(customer.brandColor).toBeNull();
    expect(customer.logoUrl).toBeNull();
    expect(customer.address).toBeNull();
    expect(customer.postalCode).toBeNull();
    expect(customer.city).toBeNull();
    expect(customer.phone).toBeNull();
    expect(customer.email).toBeNull();
    expect(customer.notes).toBeNull();
    expect(customer.responsibleTechnicianId).toBeNull();
    expect(customer.departmentId).toBe(departmentId);
    expect(customer.anonymisedAt).not.toBeNull();
    expect(customer.anonymisedBy).toBe(admin.id);

    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: fixture.contactId },
    });
    expect(contact.name).toContain("Anonymisert kontakt");
    expect(contact.email).toBeNull();
    expect(contact.phone).toBeNull();
    const delegation = await prisma.portalDelegation.findUniqueOrThrow({
      where: { contactId: fixture.contactId },
    });
    expect(delegation.isActive).toBe(false);

    const portalUser = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.portalUserId },
    });
    expect(portalUser.isActive).toBe(false);
    expect(portalUser.email).toBeNull();
    expect(portalUser.name).toContain("Anonymisert portalbruker");
    expect(portalUser.password).toBeNull();
    expect(portalUser.twoFactorSecret).toBeNull();
    expect(portalUser.sessionVersion).toBeGreaterThan(3);

    const site = await prisma.customerSite.findUniqueOrThrow({
      where: { id: fixture.siteId },
    });
    expect(site.name).toContain("Anonymisert sted");
    expect(site.address).toBeNull();
    expect(site.postalCode).toBeNull();
    expect(site.city).toBeNull();
    expect(site.latitude).toBeNull();
    expect(site.longitude).toBeNull();

    const workOrder = await prisma.workOrder.findUniqueOrThrow({
      where: { id: fixture.workOrderId },
    });
    expect(workOrder.status).toBe("COMPLETED");
    expect(workOrder.scheduledFor?.toISOString().slice(0, 10)).toBe("2026-11-10");
    expect(workOrder.reference).toContain("O-");
    expect(workOrder.address).toBeNull();
    expect(workOrder.postalCode).toBeNull();
    expect(workOrder.city).toBeNull();
    expect(workOrder.creatorName).toBeNull();
    expect(workOrder.orderNumber).toBeNull();
    expect(workOrder.title).not.toContain(fixture.customerName);
    expect(workOrder.description ?? "").not.toContain(fixture.customerName);

    const report = await prisma.report.findUniqueOrThrow({
      where: { id: fixture.reportId },
    });
    expect(report.isLocked).toBe(true);
    expect(report.reportNumber).not.toBeNull();
    expect(report.customerName).toBeNull();
    expect(report.customerSignatureUrl).toBeNull();
    expect(report.customerAcknowledgedBy).toBeNull();
    expect(report.pdfUrl).toBe(`/uploads/${fixture.reportPdfStored}`);
    expect(report.customerDataRedactedAt).not.toBeNull();
    expect(report.comments ?? "").not.toContain(fixture.customerName);
    expect(report.comments ?? "").not.toContain(fixture.customerEmail);
    expect(report.dataJson).not.toContain(fixture.customerName);
    expect(report.dataJson).not.toContain(fixture.customerEmail);

    const revisions = await prisma.reportRevision.findMany({
      where: { reportId: fixture.reportId },
    });
    for (const revision of revisions) {
      expect(revision.customerName).toBeNull();
      expect(revision.customerSignatureUrl).toBeNull();
      expect(revision.customerAcknowledgedBy).toBeNull();
      expect(revision.dataJson).not.toContain(fixture.customerName);
      expect(revision.unitsJson).not.toContain(fixture.customerName);
    }
    const units = await prisma.reportUnit.findMany({
      where: { reportId: fixture.reportId },
    });
    for (const unit of units) {
      expect(unit.answersJson).not.toContain(fixture.customerName);
      expect(unit.answersJson).not.toContain(fixture.customerEmail);
      expect(unit.label).not.toContain(fixture.customerName);
      expect(unit.comment ?? "").not.toContain(fixture.customerName);
    }

    const booking = await prisma.bookingRequest.findUniqueOrThrow({
      where: { id: fixture.bookingId },
    });
    expect(booking.contactName).toContain("Anonymisert kontakt");
    expect(booking.contactPhone).toBe("[fjernet]");

    const comment = await prisma.comment.findUniqueOrThrow({
      where: { id: fixture.commentId },
    });
    expect(comment.content).not.toContain(fixture.customerName);
    expect(comment.content).not.toContain("99887766");
    expect(comment.authorName).toBeNull();

    // Kundens egne filer og dokumenter er slettet; rapportens bevis er beholdt.
    for (const stored of [
      fixture.customerAttachmentStored,
      fixture.attachmentStored,
      fixture.documentStored,
      fixture.documentVersionStored,
      fixture.logoStored,
      fixture.customerSignatureStored,
    ]) {
      await expect(fs.access(path.join(root, stored))).rejects.toThrow();
    }
    await expect(
      fs.access(path.join(root, fixture.reportPdfStored)),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(root, fixture.technicianSignatureStored)),
    ).resolves.toBeUndefined();
    expect(
      await prisma.customerAttachment.count({
        where: { customerId: fixture.customerId },
      }),
    ).toBe(0);
    expect(
      await prisma.document.count({ where: { customerId: fixture.customerId } }),
    ).toBe(0);
    const remainingUploads = await prisma.upload.findMany({
      where: { customerId: fixture.customerId },
    });
    expect(remainingUploads.length).toBeGreaterThan(0);
    for (const upload of remainingUploads) {
      expect(upload.originalName).toBe("anonymisert fil");
    }

    const audits = await prisma.auditLog.findMany({
      where: { entityId: fixture.customerId },
      orderBy: { seq: "asc" },
    });
    expect(audits.length).toBe(beforeAudit + 1);
    const erasure = audits.find((row) =>
      row.action.includes("personvernsletting"),
    );
    expect(erasure).toBeDefined();
    const auditJson = JSON.stringify(erasure);
    expect(auditJson).not.toContain(fixture.customerName);
    expect(auditJson).not.toContain(fixture.customerEmail);
    expect(auditJson).not.toContain("99887766");
    expect(auditJson).not.toContain("998 877 665");
    expect(auditJson).toContain("[fjernet]");

    // Andre kjøring er en no-op og skriver ingen ny revisjonsrad.
    const second = await eraseCustomerData(admin, fixture.customerId, {
      reason: "Andre kjøring",
      confirmation: fixture.customerName,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.alreadyAnonymised).toBe(true);
    expect(
      await prisma.auditLog.count({ where: { entityId: fixture.customerId } }),
    ).toBe(audits.length);
  });

  it("blokkerer hele slettingen når et oppdrag har bevaringsplikt", async () => {
    const fixture = await seedFixture({ orderLegalHold: true });
    const before = await snapshot(fixture);

    const preview = await getCustomerErasurePreview(admin, fixture.customerId);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.blockers.map((row) => row.kind)).toContain(
      "work_order_legal_hold",
    );

    const result = await eraseCustomerData(admin, fixture.customerId, {
      reason: "Personvernforespørsel",
      confirmation: fixture.customerName,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("conflict");
    expect(
      erasureBlockersFromDetails(result.details).map((row) => row.kind),
    ).toContain("work_order_legal_hold");

    expect(await snapshot(fixture)).toEqual(before);
  });

  it("blokkerer når rapporten selv har bevaringsplikt", async () => {
    const fixture = await seedFixture({ reportLegalHold: true });
    const before = await snapshot(fixture);

    const result = await eraseCustomerData(admin, fixture.customerId, {
      reason: "Personvernforespørsel",
      confirmation: fixture.customerName,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("conflict");
    expect(
      erasureBlockersFromDetails(result.details).map((row) => row.kind),
    ).toContain("report_legal_hold");
    expect(await snapshot(fixture)).toEqual(before);
  });

  it("blokkerer når et aktivt AuditHold dekker en av kundens entiteter", async () => {
    const fixture = await seedFixture();
    const hold = await prisma.auditHold.create({
      data: {
        entityType: "WorkOrder",
        entityId: fixture.workOrderId,
        reason: "Tvistesak",
      },
    });
    const before = await snapshot(fixture);

    const result = await eraseCustomerData(admin, fixture.customerId, {
      reason: "Personvernforespørsel",
      confirmation: fixture.customerName,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("conflict");
    const blockers = erasureBlockersFromDetails(result.details);
    expect(blockers.map((row) => row.kind)).toContain("audit_hold");
    expect(blockers.find((row) => row.kind === "audit_hold")?.reason).toBe(
      "Tvistesak",
    );
    expect(await snapshot(fixture)).toEqual(before);

    await prisma.auditHold.delete({ where: { id: hold.id } });
  });

  it("avviser kontor, tekniker, kunde og inaktiv administrator", async () => {
    const fixture = await seedFixture();
    const before = await snapshot(fixture);

    for (const candidate of [
      actor("OFFICE"),
      actor("TECHNICIAN"),
      actor("CUSTOMER"),
      actor("ADMIN", false),
    ]) {
      const preview = await getCustomerErasurePreview(
        candidate,
        fixture.customerId,
      );
      expect(preview.ok).toBe(false);
      if (preview.ok) return;
      expect(preview.reason).toBe("forbidden");

      const result = await eraseCustomerData(candidate, fixture.customerId, {
        reason: "Forsøk",
        confirmation: fixture.customerName,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("forbidden");
    }

    expect(await snapshot(fixture)).toEqual(before);
  });
});
