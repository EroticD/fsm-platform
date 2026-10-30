import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import type { AccessUser } from "@/lib/access";
import { canReadUpload, claimUpload } from "./upload-access";

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

  it("avviser oppdragsfil når avdelingen er deaktivert", () => {
    const staff = user({ role: "TECHNICIAN" });
    expect(
      canReadUpload(staff, { ...workOrderA, departmentIsActive: false }),
    ).toBe(false);
    // Administrator beholder tilgangen for gjenoppretting.
    expect(
      canReadUpload(user({ role: "ADMIN" }), {
        ...workOrderA,
        departmentIsActive: false,
      }),
    ).toBe(true);
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

  it("krever equipment.view for utstyrsfiler og lar kunden se egne", () => {
    const equipmentFile = {
      ownerType: "EQUIPMENT",
      ownerId: "prod-1",
      departmentId: "dept-a",
      customerId: "cust-1",
      uploadedById: "u1",
    };
    expect(canReadUpload(user({ role: "TECHNICIAN" }), equipmentFile)).toBe(true);
    expect(
      canReadUpload(
        user({ role: "USER", permissionsCustomized: true, permissions: [] }),
        equipmentFile,
      ),
    ).toBe(false);
    expect(
      canReadUpload(
        user({ role: "CUSTOMER", departmentId: null, customerId: "cust-1" }),
        equipmentFile,
      ),
    ).toBe(true);
    expect(
      canReadUpload(
        user({ role: "CUSTOMER", departmentId: null, customerId: "cust-2" }),
        equipmentFile,
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

type UploadRow = {
  storedName: string;
  ownerType: string;
  ownerId: string | null;
  departmentId: string | null;
  customerId: string | null;
  uploadedById: string | null;
};

/**
 * Minimal etterligning av Prisma sin updateMany, med samme likhetslogikk som
 * databasen: alle feltene i en OR-gren må matche (null matcher null).
 */
function fakeTx(rows: UploadRow[]) {
  return {
    upload: {
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          storedName: string;
          OR: Array<Partial<UploadRow>>;
        };
        data: Partial<UploadRow>;
      }) => {
        let count = 0;
        for (const row of rows) {
          if (row.storedName !== where.storedName) continue;
          const matches = where.OR.some((condition) =>
            Object.entries(condition).every(
              ([key, value]) => row[key as keyof UploadRow] === value,
            ),
          );
          if (!matches) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
    },
  } as unknown as Prisma.TransactionClient;
}

function uploadRow(overrides: Partial<UploadRow>): UploadRow {
  return {
    storedName: "fil.pdf",
    ownerType: "USER",
    ownerId: "u1",
    departmentId: "dept-a",
    customerId: null,
    uploadedById: "u1",
    ...overrides,
  };
}

describe("claimUpload", () => {
  it("lar en bruker gjøre krav på sin egen private opplasting", async () => {
    const row = uploadRow({});
    const result = await claimUpload(fakeTx([row]), "/uploads/fil.pdf", "u1", {
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      departmentId: "dept-a",
      customerId: "cust-1",
    });

    expect(result).toEqual({ claimed: true });
    expect(row).toMatchObject({
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      departmentId: "dept-a",
      customerId: "cust-1",
    });
  });

  it("lar ikke en bruker gjøre krav på en annen brukers private opplasting", async () => {
    const row = uploadRow({ ownerId: "u2", uploadedById: "u2" });
    const result = await claimUpload(fakeTx([row]), "/uploads/fil.pdf", "u1", {
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      departmentId: "dept-a",
      customerId: "cust-1",
    });

    expect(result).toEqual({ claimed: false });
    expect(row).toMatchObject({ ownerType: "USER", ownerId: "u2" });
  });

  it("lar ikke en bruker ta over en annen brukers ueide dokumentopplasting", async () => {
    const row = uploadRow({
      ownerType: "DOCUMENT",
      ownerId: null,
      uploadedById: "u2",
    });
    const result = await claimUpload(fakeTx([row]), "/uploads/fil.pdf", "u1", {
      ownerType: "DOCUMENT",
      ownerId: null,
      departmentId: null,
      customerId: null,
    });

    expect(result).toEqual({ claimed: false });
    expect(row).toMatchObject({ ownerType: "DOCUMENT", ownerId: null });
  });

  it("lar opplasteren gjøre krav på sin egen ueide dokumentopplasting", async () => {
    const row = uploadRow({
      ownerType: "DOCUMENT",
      ownerId: null,
      uploadedById: "u1",
    });
    const result = await claimUpload(fakeTx([row]), "/uploads/fil.pdf", "u1", {
      ownerType: "DOCUMENT",
      ownerId: null,
      departmentId: null,
      customerId: null,
    });

    expect(result).toEqual({ claimed: true });
  });

  it("lar ikke en oppdragsfil flyttes til et annet oppdrag", async () => {
    const row = uploadRow({
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      uploadedById: "u1",
    });
    const result = await claimUpload(fakeTx([row]), "/uploads/fil.pdf", "u1", {
      ownerType: "WORK_ORDER",
      ownerId: "wo2",
      departmentId: "dept-b",
      customerId: "cust-2",
    });

    expect(result).toEqual({ claimed: false });
    expect(row).toMatchObject({
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      departmentId: "dept-a",
    });
  });

  it("lar ikke en kundefil flyttes til en annen kunde", async () => {
    const row = uploadRow({
      ownerType: "CUSTOMER",
      ownerId: "cust-1",
      customerId: "cust-1",
      uploadedById: "u1",
    });
    const result = await claimUpload(fakeTx([row]), "/uploads/fil.pdf", "u1", {
      ownerType: "CUSTOMER",
      ownerId: "cust-2",
      departmentId: "dept-a",
      customerId: "cust-2",
    });

    expect(result).toEqual({ claimed: false });
    expect(row).toMatchObject({
      ownerType: "CUSTOMER",
      ownerId: "cust-1",
      customerId: "cust-1",
    });
  });

  it("kan knytte en privat opplasting til utstyr", async () => {
    const row = uploadRow({});
    const result = await claimUpload(fakeTx([row]), "/uploads/fil.pdf", "u1", {
      ownerType: "EQUIPMENT",
      ownerId: "prod-1",
      departmentId: "dept-a",
      customerId: "cust-1",
    });

    expect(result).toEqual({ claimed: true });
    expect(row).toMatchObject({
      ownerType: "EQUIPMENT",
      ownerId: "prod-1",
      customerId: "cust-1",
    });
  });

  it("tillater å legge ved en fil som allerede tilhører målet", async () => {
    const row = uploadRow({
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      uploadedById: "u1",
    });
    const result = await claimUpload(fakeTx([row]), "/uploads/fil.pdf", "u1", {
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      departmentId: "dept-a",
      customerId: "cust-1",
    });

    expect(result).toEqual({ claimed: true });
  });

  it("avviser filadresser utenfor opplastingsmappen", async () => {
    const row = uploadRow({});
    const result = await claimUpload(fakeTx([row]), "/etc/passwd", "u1", {
      ownerType: "WORK_ORDER",
      ownerId: "wo1",
      departmentId: "dept-a",
      customerId: null,
    });

    expect(result).toEqual({ claimed: false });
    expect(row.ownerType).toBe("USER");
  });
});
