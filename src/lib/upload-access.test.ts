import { describe, expect, it } from "vitest";
import type { AccessUser } from "@/lib/access";
import { canReadUpload } from "./upload-access";

function user(overrides: Partial<AccessUser>): AccessUser {
  return {
    id: "u1",
    email: "u1@example.com",
    name: "Bruker",
    role: "OFFICE",
    isActive: true,
    departmentId: "dept-a",
    customerId: null,
    permissions: null,
    permissionsCustomized: false,
    roleDefinition: null,
    ...overrides,
  } as unknown as AccessUser;
}

const workOrderA = {
  ownerType: "WORK_ORDER",
  ownerId: "wo1",
  departmentId: "dept-a",
  customerId: "cust-1",
  uploadedById: "u1",
};

const workOrderB = { ...workOrderA, ownerId: "wo2", departmentId: "dept-b" };

describe("canReadUpload", () => {
  it("lar administrator lese alt", () => {
    const admin = user({ role: "ADMIN" });
    expect(canReadUpload(admin, workOrderA)).toBe(true);
    expect(canReadUpload(admin, workOrderB)).toBe(true);
    expect(
      canReadUpload(admin, { ...workOrderA, ownerType: "USER", uploadedById: "noen" }),
    ).toBe(true);
  });

  it("avviser inaktive brukere", () => {
    expect(canReadUpload(user({ isActive: false }), workOrderA)).toBe(false);
    expect(canReadUpload(null, workOrderA)).toBe(false);
  });

  it("lar ansatte lese oppdragsfil i egen avdeling, men ikke i en annen", () => {
    const staff = user({ role: "TECHNICIAN" });
    expect(canReadUpload(staff, workOrderA)).toBe(true);
    expect(canReadUpload(staff, workOrderB)).toBe(false);
  });

  it("lar kundeportalbruker lese bare sin egen kundes filer", () => {
    const customer = user({ role: "CUSTOMER", departmentId: null, customerId: "cust-1" });
    expect(canReadUpload(customer, workOrderA)).toBe(true);
    expect(
      canReadUpload(customer, { ...workOrderA, ownerId: "wo3", customerId: "cust-2" }),
    ).toBe(false);
    expect(
      canReadUpload(customer, {
        ownerType: "CUSTOMER",
        ownerId: "cust-2",
        departmentId: "dept-a",
        customerId: "cust-2",
        uploadedById: null,
      }),
    ).toBe(false);
  });

  it("krever customers.view for kundefiler", () => {
    const office = user({ role: "OFFICE" });
    const customerFile = {
      ownerType: "CUSTOMER",
      ownerId: "cust-1",
      departmentId: "dept-a",
      customerId: "cust-1",
      uploadedById: "u1",
    };
    expect(canReadUpload(office, customerFile)).toBe(true);

    const tanpa = user({
      role: "USER",
      permissionsCustomized: true,
      permissions: [],
    });
    expect(canReadUpload(tanpa, customerFile)).toBe(false);
  });

  it("krever documents.view for dokumentfiler", () => {
    const doc = {
      ownerType: "DOCUMENT",
      ownerId: "doc-1",
      departmentId: null,
      customerId: null,
      uploadedById: "u1",
    };
    expect(canReadUpload(user({ role: "OFFICE" }), doc)).toBe(true);
    expect(
      canReadUpload(
        user({ role: "USER", permissionsCustomized: true, permissions: [] }),
        doc,
      ),
    ).toBe(false);
  });

  it("lar bare opplasteren lese private filer", () => {
    const priv = {
      ownerType: "USER",
      ownerId: "u1",
      departmentId: "dept-a",
      customerId: null,
      uploadedById: "u1",
    };
    expect(canReadUpload(user({ id: "u1" }), priv)).toBe(true);
    expect(canReadUpload(user({ id: "u2" }), priv)).toBe(false);
  });

  it("avviser ukjente eiertyper for vanlige brukere", () => {
    expect(
      canReadUpload(user({ role: "OFFICE" }), { ...workOrderA, ownerType: "UKJENT" }),
    ).toBe(false);
  });
});
