import { describe, expect, it } from "vitest";
import {
  BILLING_AMOUNT_FIELDS,
  CUSTOMER_CONTACT_FIELDS,
  FIELD_GROUPS,
  FIELD_PERMISSION_KEYS,
  PAYROLL_AMOUNT_FIELDS,
  REPORT_SIGNATURE_FIELDS,
  canSeeField,
  fieldAccess,
  maskEmail,
  maskPhone,
  redactRecord,
  type FieldPolicyActor,
} from "./field-rbac";

function actor(overrides: Partial<FieldPolicyActor> = {}): FieldPolicyActor {
  return {
    id: "u1",
    role: "TECHNICIAN",
    isActive: true,
    customerId: null,
    permissions: [],
    permissionsCustomized: false,
    ...overrides,
  };
}

describe("fieldAccess – policy matrix", () => {
  it("ADMIN og OFFICE beholder full tilgang til alle feltgrupper", () => {
    for (const role of ["ADMIN", "OFFICE"]) {
      for (const group of FIELD_GROUPS) {
        expect(
          fieldAccess(actor({ role }), group, {
            ownerId: "someone-else",
            customerId: "c1",
          }),
        ).toEqual({ level: "full", masked: false, source: "role" });
      }
    }
  });

  it("montør ser ikke kundekontakt eller fakturabeløp", () => {
    expect(
      fieldAccess(actor(), "customerContact", { customerId: "c1" }).masked,
    ).toBe(true);
    expect(
      fieldAccess(actor(), "billingAmounts", { customerId: "c1" }).masked,
    ).toBe(true);
  });

  it("montør ser egne lønnsbeløp, men ikke andres", () => {
    expect(
      fieldAccess(actor({ id: "u1" }), "payrollAmounts", { ownerId: "u1" }),
    ).toEqual({ level: "full", masked: false, source: "scope" });
    expect(
      fieldAccess(actor({ id: "u1" }), "payrollAmounts", { ownerId: "u2" })
        .masked,
    ).toBe(true);
  });

  it("kundeportalen ser bare egne kontakt- og fakturafelt", () => {
    const customer = actor({ role: "CUSTOMER", customerId: "c1", id: "cu1" });
    expect(
      fieldAccess(customer, "customerContact", { customerId: "c1" }).masked,
    ).toBe(false);
    expect(
      fieldAccess(customer, "billingAmounts", { customerId: "c2" }).masked,
    ).toBe(true);
    expect(
      fieldAccess(customer, "payrollAmounts", { ownerId: "cu1" }).masked,
    ).toBe(true);
  });

  it("USER og inaktive kontoer får ingenting", () => {
    expect(fieldAccess(actor({ role: "USER" }), "billingAmounts").masked).toBe(
      true,
    );
    expect(
      fieldAccess(actor({ isActive: false }), "billingAmounts").masked,
    ).toBe(true);
  });

  it("en eksplisitt feltnøkkel utvider tilgangen uten å gi rolle", () => {
    const granted = actor({
      permissionsCustomized: true,
      permissions: [FIELD_PERMISSION_KEYS.billingAmounts],
    });
    expect(
      fieldAccess(granted, "billingAmounts", { customerId: "c1" }),
    ).toEqual({ level: "full", masked: false, source: "explicit" });
    expect(canSeeField(granted, "billingAmounts")).toBe(true);
  });
});

describe("maskering", () => {
  it("maskerer e-post og telefon uten å lekke hele verdien", () => {
    expect(maskEmail("kari.nordmann@example.no")).toBe("k•••@•••.no");
    expect(maskPhone("+47 912 34 567")).toBe("•• •• •• 67");
    expect(maskEmail(null)).toBeNull();
    expect(maskPhone("")).toBeNull();
  });

  it("fjerner beløp og signatur-URL-er fra en kopi", () => {
    const invoice = {
      id: "inv1",
      customerId: "c1",
      total: 12500,
      outstanding: 5000,
      currency: "NOK",
    };
    const redacted = redactRecord(actor(), invoice, {
      group: "billingAmounts",
      fields: BILLING_AMOUNT_FIELDS,
      customerId: "c1",
    });

    expect(redacted).toMatchObject({
      id: "inv1",
      currency: "NOK",
      total: null,
      outstanding: null,
      redactedFields: ["total", "outstanding"],
    });
    expect(JSON.stringify(redacted)).not.toContain("12500");
    expect(JSON.stringify(redacted)).not.toContain("5000");
  });

  it("maskerer kontaktinfo og signaturer uten å fjerne uskyldige felt", () => {
    const contact = {
      id: "ct1",
      name: "Kari",
      email: "kari@example.no",
      phone: "91234567",
      role: "Drift",
    };
    const redacted = redactRecord(actor(), contact, {
      group: "customerContact",
      fields: CUSTOMER_CONTACT_FIELDS,
      customerId: "c1",
    });
    expect(redacted).toMatchObject({
      id: "ct1",
      name: "Kari",
      role: "Drift",
      email: "k•••@•••.no",
      phone: "•• •• •• 67",
    });

    const report = {
      id: "r1",
      technicianSignatureUrl: "/uploads/signature-1.png",
      customerSignatureUrl: "/uploads/signature-2.png",
      completedAt: "2026-01-01",
    };
    const masked = redactRecord(
      actor({ role: "CUSTOMER", customerId: "c2" }),
      report,
      {
        group: "reportSignatures",
        fields: REPORT_SIGNATURE_FIELDS,
        customerId: "c1",
      },
    );
    expect(masked.technicianSignatureUrl).toBeNull();
    expect(masked.customerSignatureUrl).toBeNull();
    expect(JSON.stringify(masked)).not.toContain("signature-1");
  });

  it("beholder egne lønnsbeløp og maskerer andres", () => {
    const own = redactRecord(actor({ id: "u1" }), { userId: "u1", amount: 500 }, {
      group: "payrollAmounts",
      fields: PAYROLL_AMOUNT_FIELDS,
      ownerId: "u1",
    });
    expect(own.amount).toBe(500);

    const other = redactRecord(actor({ id: "u1" }), { userId: "u2", amount: 500 }, {
      group: "payrollAmounts",
      fields: PAYROLL_AMOUNT_FIELDS,
      ownerId: "u2",
    });
    expect(other.amount).toBeNull();
    expect(JSON.stringify(other)).not.toContain("500");
  });
});
