import { describe, expect, it } from "vitest";
import {
  emptyErasureCounts,
  eraseCustomerData,
  getCustomerErasurePreview,
  neutralContactName,
  neutralCustomerName,
  neutralSiteName,
  redactErasureJson,
  redactErasureText,
} from "./customer-erasure";
import type { ServiceActor } from "./actor";

const admin: ServiceActor = {
  id: "a1",
  name: "Admin",
  email: "admin@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: "d1",
  permissionsCustomized: false,
  permissions: [],
  roleDefinition: null,
};

const office: ServiceActor = {
  ...admin,
  role: "OFFICE",
  permissions: ["customers.manage"],
  permissionsCustomized: true,
};

describe("customer-erasure helpers", () => {
  it("lager stabile, nøytrale navn fra id", () => {
    expect(neutralCustomerName("cust-12345678")).toBe(
      "Anonymisert kunde 12345678",
    );
    expect(neutralContactName("contact-87654321")).toBe(
      "Anonymisert kontakt 87654321",
    );
    expect(neutralSiteName("site-abcdefgh")).toBe("Anonymisert sted abcdefgh");
  });

  it("fjerner kjente identifikatorer og e-post fra fritekst", () => {
    const text = redactErasureText(
      "Kunde Kunde Alfa, e-post kunde@example.test, telefon 99887766.",
      ["Kunde Alfa", "99887766"],
    );
    expect(text).toBe("Kunde [fjernet], e-post [fjernet], telefon [fjernet].");
  });

  it("bevarer JSON-struktur og nuller kjente kundenøkler", () => {
    const json = redactErasureJson(
      JSON.stringify({
        status: "GODKJENT",
        customerName: "Kunde Alfa",
        customerSignatureUrl: "/uploads/sig.png",
        answers: { note: "Kontakt Kunde Alfa" },
      }),
      ["Kunde Alfa"],
    );
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json ?? "{}");
    expect(parsed.status).toBe("GODKJENT");
    expect(parsed.customerName).toBeNull();
    expect(parsed.customerSignatureUrl).toBeNull();
    expect(parsed.answers.note).toBe("Kontakt [fjernet]");
  });

  it("takler ugyldig JSON uten å kaste", () => {
    expect(redactErasureJson("Kunde Alfa", ["Kunde Alfa"])).toBe("[fjernet]");
  });

  it("har en tom tellemodell for no-op", () => {
    expect(emptyErasureCounts().workOrders).toBe(0);
    expect(emptyErasureCounts().reportPdfsRetained).toBe(0);
  });

  it("avviser ikke-administrator før databasekall", async () => {
    const preview = await getCustomerErasurePreview(office, "c1");
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.reason).toBe("forbidden");

    const result = await eraseCustomerData(office, "c1", {
      reason: "Personvern",
      confirmation: "Kunde",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("forbidden");
  });

  it("avviser ugyldig id og tomt input for administrator", async () => {
    const noId = await eraseCustomerData(admin, "", {
      reason: "Personvern",
      confirmation: "Kunde",
    });
    expect(noId.ok).toBe(false);
    if (noId.ok) return;
    expect(noId.reason).toBe("invalid");
  });
});
