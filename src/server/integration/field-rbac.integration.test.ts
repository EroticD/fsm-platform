import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ServiceActor } from "@/server/actor";
import { getCustomerDetail } from "@/server/customers";
import { performSearch } from "@/lib/search";
import type { AccessUser } from "@/lib/access";
import {
  exportInvoicesCsv,
  getInvoice,
  getPortalInvoice,
} from "@/server/invoices";

const describeIntegration = integrationEnabled ? describe : describe.skip;

let departmentId = "";
let customerId = "";
let contactId = "";
let invoiceId = "";
const prefix = unique("field-rbac-it");

function actor(
  role: string,
  overrides: Partial<ServiceActor> = {},
): ServiceActor {
  return {
    id: `${prefix}-${role.toLowerCase()}`,
    name: role,
    email: `${role.toLowerCase()}@example.test`,
    role,
    isActive: true,
    departmentId,
    customerId: null,
    permissions: [],
    permissionsCustomized: false,
    roleDefinition: { permissions: [] },
    ...overrides,
  };
}

let admin: ServiceActor;
let office: ServiceActor;
let technician: ServiceActor;
let customer: ServiceActor;

beforeAll(async () => {
  const department = await prisma.department.create({
    data: { name: `${prefix}-avd` },
  });
  departmentId = department.id;
  customerId = (
    await prisma.customer.create({
      data: {
        name: `${prefix} Kunde`,
        email: "kunde@example.test",
        phone: "99887766",
        departmentId,
      },
    })
  ).id;
  contactId = (
    await prisma.contact.create({
      data: {
        customerId,
        name: "Kontakt Person",
        email: "kontakt@example.test",
        phone: "91234567",
      },
    })
  ).id;
  invoiceId = (
    await prisma.invoice.create({
      data: {
        customerId,
        contactId,
        departmentId,
        status: "SENT",
        total: new Prisma.Decimal(12500),
        subtotal: new Prisma.Decimal(10000),
        vatTotal: new Prisma.Decimal(2500),
        outstanding: new Prisma.Decimal(5000),
        paidTotal: new Prisma.Decimal(7500),
      },
    })
  ).id;
  admin = actor("ADMIN", { roleDefinition: { permissions: [] } });
  office = actor("OFFICE", {
    permissionsCustomized: true,
    permissions: ["customers.view", "customers.manage", "reports.view"],
  });
  technician = actor("TECHNICIAN", {
    permissionsCustomized: true,
    permissions: ["customers.view", "reports.view"],
  });
  customer = actor("CUSTOMER", { customerId });
});

afterAll(async () => {
  if (invoiceId) await prisma.invoice.deleteMany({ where: { id: invoiceId } });
  if (contactId) await prisma.contact.deleteMany({ where: { id: contactId } });
  if (customerId) {
    await prisma.customer.deleteMany({ where: { id: customerId } });
  }
  if (departmentId) {
    await prisma.department.deleteMany({ where: { id: departmentId } });
  }
});

describeIntegration("feltnivå-RBAC mot ekte database", () => {
  it("OFFICE ser full kundekontakt, montør får maskert verdi", async () => {
    const officeResult = await getCustomerDetail(office, customerId, {
      tab: "mer",
      orderPage: 1,
    });
    expect(officeResult.ok).toBe(true);
    if (!officeResult.ok) return;
    const officeContact = officeResult.data.customer.contacts[0];
    expect(officeContact.email).toBe("kontakt@example.test");
    expect(officeContact.phone).toBe("91234567");

    const techResult = await getCustomerDetail(technician, customerId, {
      tab: "mer",
      orderPage: 1,
    });
    expect(techResult.ok).toBe(true);
    if (!techResult.ok) return;
    const techContact = techResult.data.customer.contacts[0];
    expect(techContact.email).toBe("k•••@•••.test");
    expect(techContact.phone).toBe("•• •• •• 67");
    expect(techResult.data.customer.email).toBe("k•••@•••.test");
    expect(JSON.stringify(techResult.data)).not.toContain(
      "kontakt@example.test",
    );
    expect(JSON.stringify(techResult.data)).not.toContain("91234567");
  });

  it("søket viser maskert kontaktinfo til montør", async () => {
    const techUser = {
      ...technician,
      department: { id: departmentId, name: "Test", isActive: true },
    } as unknown as AccessUser;

    const result = await performSearch("Kontakt", {
      user: techUser,
      pageSize: 20,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("kontakt@example.test");
    expect(serialized).not.toContain("91234567");
  });

  it("ADMIN og OFFICE ser fakturabeløp, montør får null", async () => {
    const adminResult = await getInvoice(admin, invoiceId);
    expect(adminResult.ok).toBe(true);
    if (!adminResult.ok) return;
    expect(Number(adminResult.data.total)).toBe(12500);

    const officeResult = await getInvoice(office, invoiceId);
    expect(officeResult.ok).toBe(true);

    const techResult = await getInvoice(technician, invoiceId);
    expect(techResult.ok).toBe(true);
    if (!techResult.ok) return;
    expect(techResult.data.total).toBeNull();
    expect(techResult.data.outstanding).toBeNull();
    expect(techResult.data.customer.email).toBe("k•••@•••.test");
    expect(JSON.stringify(techResult.data)).not.toContain("12500");
    expect(JSON.stringify(techResult.data)).not.toContain(
      "kontakt@example.test",
    );
    expect(JSON.stringify(techResult.data)).not.toContain("91234567");
  });

  it("kundeportalen ser egne fakturabeløp", async () => {
    const result = await getPortalInvoice(customer, invoiceId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Number(result.data.total)).toBe(12500);
  });

  it("CSV-eksport lekker ikke beløp til en rolle uten eksporttilgang", async () => {
    const technicianExport = await exportInvoicesCsv(technician, {});
    expect(technicianExport).toMatchObject({ ok: false, reason: "forbidden" });

    const officeExport = await exportInvoicesCsv(office, {});
    expect(officeExport.ok).toBe(true);
    if (!officeExport.ok) return;
    expect(officeExport.data.csv).toContain("12500");
    expect(officeExport.data.csv).toContain("5000");
  });
});
