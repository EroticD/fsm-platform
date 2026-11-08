import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "./actor";

vi.mock("@/server/modules", () => ({
  assertModule: vi.fn(async () => undefined),
  moduleEnabled: vi.fn(async () => true),
}));

import {
  createInvoicePaymentLink,
  validateProviderPayment,
} from "./payments";

const admin: ServiceActor = {
  id: "admin-1",
  name: "Admin",
  email: "admin@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: null,
  permissionsCustomized: false,
  permissions: [],
  roleDefinition: null,
};

const technician: ServiceActor = {
  id: "tech-1",
  name: "Tekniker",
  email: "tech@example.test",
  role: "TECHNICIAN",
  isActive: true,
  departmentId: "dept-1",
  permissionsCustomized: true,
  permissions: [],
  roleDefinition: null,
};

const invoice = {
  status: "SENT",
  total: "1000.00",
  paidTotal: "400.00",
  creditedTotal: "0.00",
  currency: "NOK",
  dueDate: new Date("2026-12-01T00:00:00Z"),
  issueDate: new Date("2026-11-01T00:00:00Z"),
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validering av PSP-betaling", () => {
  it("godtar delbetaling og full betaling", () => {
    expect(
      validateProviderPayment({ amount: "250.00", currency: "NOK", invoice }),
    ).toBe("ok");
    expect(
      validateProviderPayment({ amount: "600.00", currency: "NOK", invoice }),
    ).toBe("ok");
  });

  it("avviser feil valuta", () => {
    expect(
      validateProviderPayment({ amount: "100.00", currency: "USD", invoice }),
    ).toBe("currency_mismatch");
  });

  it("avviser for høyt og ugyldig beløp", () => {
    expect(
      validateProviderPayment({ amount: "600.01", currency: "NOK", invoice }),
    ).toBe("amount_too_high");
    expect(
      validateProviderPayment({ amount: "0", currency: "NOK", invoice }),
    ).toBe("invalid_amount");
  });

  it("avviser faktura som ikke kan betales", () => {
    expect(
      validateProviderPayment({
        amount: "100.00",
        currency: "NOK",
        invoice: { ...invoice, status: "DRAFT" },
      }),
    ).toBe("not_payable");
  });
});

describe("tilgang og deaktivert leverandør", () => {
  it("avviser aktør uten fakturarettighet uten å kalle leverandøren", async () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "stripe");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createInvoicePaymentLink(technician, "inv-1");
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("er en no-op når betalingsleverandøren er av", async () => {
    vi.stubEnv("PAYMENTS_PROVIDER", "");
    const result = await createInvoicePaymentLink(admin, "inv-1");
    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      details: { code: "payments.disabled" },
    });
  });
});
