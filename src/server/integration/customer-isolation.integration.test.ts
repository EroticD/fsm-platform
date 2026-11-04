import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";
import { getCustomerDetail } from "@/server/customers";
import { getCustomerSiteOptions } from "@/server/customer-sites";
import {
  createEquipment,
  getCustomerEquipmentOptions,
  getEquipmentFormOptions,
} from "@/server/equipment";
import { createWorkOrder, updateWorkOrder } from "@/server/work-orders";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("kundeisolasjon og kundesøk", () => {
  let departmentId = "";
  let customerAId = "";
  let customerBId = "";
  let siteAId = "";
  let siteBId = "";
  let productAId = "";
  let productBId = "";
  let workOrderAId = "";
  const actor: ServiceActor = {
    id: "isolation-actor",
    name: "Isolasjonstest",
    email: "isolation@example.test",
    role: "OFFICE",
    isActive: true,
    departmentId: null,
    permissionsCustomized: true,
    permissions: [
      "customers.view",
      "customers.manage",
      "equipment.view",
      "equipment.manage",
      "workorders.view",
      "workorders.create",
      "workorders.edit",
    ],
    roleDefinition: null,
  };

  beforeAll(async () => {
    const department = await prisma.department.create({
      data: { name: unique("IT-isolasjon") },
    });
    departmentId = department.id;
    actor.departmentId = departmentId;

    const customerA = await prisma.customer.create({
      data: { name: unique("Kunde Alfa"), departmentId },
    });
    const customerB = await prisma.customer.create({
      data: { name: unique("Kunde Beta"), departmentId },
    });
    customerAId = customerA.id;
    customerBId = customerB.id;

    const siteA = await prisma.customerSite.create({
      data: {
        customerId: customerAId,
        name: "Lager Alfa",
        address: "Alfavegen 1",
        postalCode: "6001",
        city: "Ålesund",
        isPrimary: true,
      },
    });
    const siteB = await prisma.customerSite.create({
      data: {
        customerId: customerBId,
        name: "Lager Beta",
        address: "Betavegen 2",
        postalCode: "5001",
        city: "Bergen",
        isPrimary: true,
      },
    });
    siteAId = siteA.id;
    siteBId = siteB.id;

    const productA = await prisma.product.create({
      data: {
        customerId: customerAId,
        model: "Pumpe Alfa",
        serialNumber: unique("ALFA"),
        status: "ACTIVE",
        criticality: 2,
      },
    });
    const productB = await prisma.product.create({
      data: {
        customerId: customerBId,
        model: "Pumpe Beta",
        serialNumber: unique("BETA"),
        status: "ACTIVE",
        criticality: 2,
      },
    });
    productAId = productA.id;
    productBId = productB.id;

    const workOrderA = await prisma.workOrder.create({
      data: {
        title: unique("Isolasjonsoppdrag"),
        reference: unique("ISO"),
        description: "",
        departmentId,
        customerId: customerAId,
        status: "OPEN",
        scheduledFor: new Date("2026-12-01"),
        siteId: siteAId,
      },
    });
    workOrderAId = workOrderA.id;
  });

  afterAll(async () => {
    await prisma.workOrder.deleteMany({
      where: { customerId: { in: [customerAId, customerBId] } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: [productAId, productBId] } },
    });
    await prisma.customerSite.deleteMany({
      where: { id: { in: [siteAId, siteBId] } },
    });
    await prisma.customer.deleteMany({
      where: { id: { in: [customerAId, customerBId] } },
    });
    await prisma.department.deleteMany({ where: { id: departmentId } });
  });

  it("returnerer bare kundens egne steder og enheter i kundekortets payload", async () => {
    const sites = await getCustomerSiteOptions(actor, customerAId);
    expect(sites.ok).toBe(true);
    if (!sites.ok) return;
    expect(sites.data.sites.map((site) => site.name)).toEqual(["Lager Alfa"]);

    const units = await getCustomerEquipmentOptions(actor, customerAId);
    expect(units.ok).toBe(true);
    if (!units.ok) return;
    expect(units.data.equipment.map((unit) => unit.model)).toEqual([
      "Pumpe Alfa",
    ]);

    const detail = await getCustomerDetail(actor, customerAId, {
      tab: "mer",
      orderPage: 1,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    const payload = JSON.stringify(detail.data);
    expect(payload).toContain("Lager Alfa");
    expect(payload).not.toContain("Lager Beta");
    expect(payload).not.toContain("Pumpe Beta");
    expect(detail.data.sites.map((site) => site.name)).toEqual(["Lager Alfa"]);

    const unitDetail = await getCustomerDetail(actor, customerAId, {
      tab: "utstyr",
      orderPage: 1,
    });
    expect(unitDetail.ok).toBe(true);
    if (!unitDetail.ok) return;
    const unitPayload = JSON.stringify(unitDetail.data);
    expect(unitPayload).toContain("Pumpe Alfa");
    expect(unitPayload).not.toContain("Pumpe Beta");
    expect(unitDetail.data.products.map((unit) => unit.model)).toEqual([
      "Pumpe Alfa",
    ]);
  });

  it("lar ikke en annen kundes steder eller enheter komme med i søket", async () => {
    const foreignSite = await getCustomerSiteOptions(actor, customerAId, {
      query: "beta",
    });
    expect(foreignSite.ok).toBe(true);
    if (!foreignSite.ok) return;
    expect(foreignSite.data.sites).toEqual([]);
    expect(foreignSite.data.total).toBe(0);

    const foreignUnit = await getCustomerEquipmentOptions(actor, customerAId, {
      query: "beta",
    });
    expect(foreignUnit.ok).toBe(true);
    if (!foreignUnit.ok) return;
    expect(foreignUnit.data.equipment).toEqual([]);
    expect(foreignUnit.data.total).toBe(0);
  });

  it("søker aksent- og tegnsettingstolerant innenfor kunden", async () => {
    const byCity = await getCustomerSiteOptions(actor, customerAId, {
      query: "alesund",
    });
    expect(byCity.ok).toBe(true);
    if (!byCity.ok) return;
    expect(byCity.data.sites.map((site) => site.name)).toEqual(["Lager Alfa"]);

    const byName = await getCustomerSiteOptions(actor, customerAId, {
      query: "LAGER-ALFA",
    });
    expect(byName.ok).toBe(true);
    if (!byName.ok) return;
    expect(byName.data.sites.map((site) => site.name)).toEqual(["Lager Alfa"]);
  });

  it("returnerer ikke hele steds- eller enhetsregisteret i skjemavalgene", async () => {
    const options = await getEquipmentFormOptions(actor);
    expect(options.ok).toBe(true);
    if (!options.ok) return;
    expect(Object.keys(options.data).sort()).toEqual(["categories", "customers"]);
    const payload = JSON.stringify(options.data);
    expect(payload).not.toContain("Lager Alfa");
    expect(payload).not.toContain("Lager Beta");
    expect(payload).not.toContain("Pumpe Alfa");
    expect(payload).not.toContain("Pumpe Beta");
  });

  it("avviser krysskunde-sted når oppdrag og utstyr lagres", async () => {
    const created = await createWorkOrder(actor as never, {
      title: "Krysskunde",
      description: "",
      departmentId,
      customerId: customerAId,
      contactId: "",
      siteId: siteBId,
      scheduledFor: "2026-12-02",
      scheduledTo: "",
      technicianIds: [],
      templateIds: [],
      tagNames: [],
    });
    expect(created).toEqual({ ok: false, error: "ugyldig-data" });

    const updated = await updateWorkOrder(actor as never, workOrderAId, {
      title: "Krysskunde",
      description: "",
      departmentId,
      customerId: customerAId,
      contactId: "",
      siteId: siteBId,
      scheduledFor: "2026-12-02",
      scheduledTo: "",
      technicianIds: [],
      tagNames: [],
    });
    expect(updated).toEqual({ ok: false, error: "ugyldig-data" });

    const equipment = await createEquipment(actor, {
      customerId: customerAId,
      model: "Krysskunde-enhet",
      siteId: siteBId,
    });
    expect(equipment).toMatchObject({
      ok: false,
      details: { code: "equipment.errors.customerMismatch" },
    });

    const unchanged = await prisma.workOrder.findUnique({
      where: { id: workOrderAId },
      select: { siteId: true },
    });
    expect(unchanged?.siteId).toBe(siteAId);
    expect(
      await prisma.product.count({ where: { model: "Krysskunde-enhet" } }),
    ).toBe(0);
  });

  it("holder kundefilteret i utstyrslista uten å telle andre kunder", async () => {
    const { listEquipment } = await import("@/server/equipment");
    const result = await listEquipment(actor, {
      customerId: customerAId,
      page: 1,
      limit: 20,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(1);
    expect(result.data.items.map((item) => item.model)).toEqual(["Pumpe Alfa"]);
    expect(JSON.stringify(result.data)).not.toContain("Pumpe Beta");

    const foreign = await listEquipment(actor, {
      customerId: customerAId,
      q: "beta",
      page: 1,
      limit: 20,
    });
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    expect(foreign.data.total).toBe(0);
    expect(foreign.data.items).toEqual([]);
  });
});
