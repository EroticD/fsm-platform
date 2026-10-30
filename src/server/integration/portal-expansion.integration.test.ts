import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";
import {
  createPortalSite,
  getPortalContracts,
  getPortalDocuments,
  getPortalEquipment,
  getPortalSites,
  getPortalVisitTimeline,
} from "@/server/portal-expansion";

const describeIntegration = integrationEnabled ? describe : describe.skip;

function actor(overrides: Partial<ServiceActor> = {}): ServiceActor {
  return {
    id: "portal-it-user",
    name: "Portal Integrasjon",
    email: "portal-it@example.test",
    role: "CUSTOMER",
    isActive: true,
    departmentId: null,
    customerId: null,
    contactId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: null,
    ...overrides,
  };
}

describeIntegration("Kundeportalens utvidelse", () => {
  let departmentId = "";
  let customerId = "";
  let otherCustomerId = "";
  let contactId = "";
  let otherSiteId = "";
  let workOrderId = "";
  let visitId = "";
  let customerActor: ServiceActor;

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-portal-avd"), trackingEnabled: true },
    });
    departmentId = department.id;

    const [customer, otherCustomer] = await Promise.all([
      prisma.customer.create({
        data: {
          name: unique("IT-portal-kunde"),
          departmentId,
          address: "Testveien 1",
          postalCode: "1234",
          city: "Oslo",
          brandColor: "#123456",
          logoUrl: "/uploads/portal-logo.png",
        },
      }),
      prisma.customer.create({
        data: { name: unique("IT-portal-annen"), departmentId },
      }),
    ]);
    customerId = customer.id;
    otherCustomerId = otherCustomer.id;

    const contact = await prisma.contact.create({
      data: {
        customerId,
        name: "Delegert Kontakt",
        email: `${unique("portal-kontakt")}@example.test`,
        phone: "+4790000000",
      },
    });
    contactId = contact.id;

    const otherSite = await prisma.customerSite.create({
      data: { customerId: otherCustomerId, name: "Annen adresse", isPrimary: true },
    });
    otherSiteId = otherSite.id;

    const workOrder = await prisma.workOrder.create({
      data: {
        title: unique("IT-portal-oppdrag"),
        departmentId,
        customerId,
        status: "PLANNED",
        scheduledFor: new Date("2026-11-01T00:00:00Z"),
      },
    });
    workOrderId = workOrder.id;

    const visit = await prisma.visit.create({
      data: {
        workOrderId,
        sequence: 0,
        startsAt: new Date("2026-11-01T09:00:00Z"),
        endsAt: new Date("2026-11-01T10:00:00Z"),
        status: "EN_ROUTE",
      },
    });
    visitId = visit.id;
    await prisma.trackingLink.create({
      data: {
        tokenHash: unique("tracking-hash").padEnd(64, "0").slice(0, 64),
        workOrderId,
        visitId,
        expiresAt: new Date("2026-11-01T12:00:00Z"),
      },
    });

    await prisma.upload.createMany({
      data: [
        {
          storedName: `${unique("portal-doc")}.pdf`,
          originalName: "egen.pdf",
          mimeType: "application/pdf",
          size: 10,
          ownerType: "CUSTOMER",
          ownerId: customerId,
          customerId,
        },
        {
          storedName: `${unique("portal-doc-other")}.pdf`,
          originalName: "fremmed.pdf",
          mimeType: "application/pdf",
          size: 10,
          ownerType: "CUSTOMER",
          ownerId: otherCustomerId,
          customerId: otherCustomerId,
        },
      ],
    });

    customerActor = actor({ customerId, contactId });
  });

  afterAll(async () => {
    await prisma.portalDelegation.deleteMany({ where: { contactId } });
    await prisma.upload.deleteMany({
      where: { customerId: { in: [customerId, otherCustomerId] } },
    });
  });

  it("respekterer delegering for dokumenter", async () => {
    await prisma.portalDelegation.upsert({
      where: { contactId },
      update: { canViewDocuments: false, isActive: true },
      create: {
        contactId,
        canBook: true,
        canViewDocuments: false,
        canViewContracts: true,
        canViewEquipment: true,
      },
    });

    await expect(
      getPortalDocuments(customerActor, { page: 1 }),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });

    await prisma.portalDelegation.update({
      where: { contactId },
      data: { canViewDocuments: true },
    });
    const documents = await getPortalDocuments(customerActor, { page: 1 });
    expect(documents.ok).toBe(true);
    if (!documents.ok) return;
    expect(documents.data.items).toHaveLength(1);
    expect(documents.data.items[0].name).toBe("egen.pdf");
  });

  it("viser bare kundens egne steder og oppretter trygt nye", async () => {
    const created = await createPortalSite(customerActor, {
      name: "Lager sør",
      address: "Lagergata 2",
      postalCode: "1235",
      city: "Oslo",
    });
    expect(created.ok).toBe(true);

    const sites = await getPortalSites(customerActor);
    expect(sites.ok).toBe(true);
    if (!sites.ok) return;
    expect(sites.data.some((site) => site.id === otherSiteId)).toBe(false);
    expect(sites.data.some((site) => site.name === "Lager sør")).toBe(true);
  });

  it("faller tilbake til kundens adresse når oppdraget mangler sted", async () => {
    const timeline = await getPortalVisitTimeline(customerActor);
    expect(timeline.ok).toBe(true);
    if (!timeline.ok) return;
    const visit = timeline.data.upcoming.find((item) => item.id === visitId);
    expect(visit).toMatchObject({
      address: "Testveien 1, 1234, Oslo",
      canTrack: true,
      hasActiveTracking: true,
      status: "EN_ROUTE",
    });
  });

  it("henter utstyr og avtaler med avgrensede spørringer", async () => {
    const site = await prisma.customerSite.findFirst({
      where: { customerId, name: "Lager sør" },
      select: { id: true },
    });
    await prisma.product.create({
      data: {
        model: unique("Portal pumpe"),
        serialNumber: "SN-1",
        customerId,
        siteId: site?.id ?? null,
        status: "ACTIVE",
      },
    });
    await prisma.contract.create({
      data: {
        title: unique("Portal avtale"),
        customerId,
        departmentId,
        intervalMonths: 12,
        startDate: new Date("2026-01-01T00:00:00Z"),
        nextServiceDate: new Date("2027-01-01T00:00:00Z"),
        status: "ACTIVE",
      },
    });

    const equipment = await getPortalEquipment(customerActor, { page: 1 });
    expect(equipment.ok).toBe(true);
    if (!equipment.ok) return;
    expect(equipment.data.items.some((item) => item.serialNumber === "SN-1")).toBe(
      true,
    );

    const contracts = await getPortalContracts(customerActor, { page: 1 });
    expect(contracts.ok).toBe(true);
    if (!contracts.ok) return;
    expect(contracts.data.items.length).toBeGreaterThan(0);
    expect(contracts.data.items[0].title).toContain("Portal avtale");
  });
});
