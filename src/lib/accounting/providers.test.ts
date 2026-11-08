import { afterEach, describe, expect, it, vi } from "vitest";
import { csvProvider } from "./csv";
import { fikenProvider } from "./fiken";
import { tripletexProvider } from "./tripletex";
import { powerOfficeProvider, resetPowerOfficeTokenCache } from "./poweroffice";
import { AccountingError } from "./types";

const customer = {
  id: "cust-1",
  name: "Kunde AS",
  orgNumber: "999888777",
  email: "kunde@example.test",
  phone: "12345678",
  address: "Gate 1",
  postalCode: "0150",
  city: "Oslo",
};

const invoice = {
  id: "inv-1",
  invoiceNumber: "F-2026-00001",
  issueDate: "2026-11-09",
  dueDate: "2026-11-23",
  currency: "NOK",
  externalCustomerId: "123",
  customer,
  lines: [
    {
      description: "Service",
      quantity: "2.00",
      unit: "stk",
      unitPrice: "100.00",
      vatRate: "25.00",
      lineTotal: "200.00",
      lineVat: "50.00",
    },
  ],
  subtotal: "200.00",
  vatTotal: "50.00",
  total: "250.00",
  notes: null,
};

const payment = {
  id: "pay-1",
  invoiceId: "inv-1",
  invoiceNumber: "F-2026-00001",
  externalInvoiceId: "999",
  amount: "250.00",
  currency: "NOK",
  paidAt: "2026-11-10",
  reference: "bank",
  method: "BANK_TRANSFER",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function created(location: string, body?: unknown) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status: 201,
    headers: { "content-type": "application/json", location },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetPowerOfficeTokenCache();
});

describe("Fiken-konnektor", () => {
  it("er ikke konfigurert uten token og selskap", async () => {
    vi.stubEnv("FIKEN_TOKEN", "");
    vi.stubEnv("FIKEN_COMPANY_SLUG", "");
    expect(fikenProvider.configured()).toBe(false);
    await expect(fikenProvider.syncCustomer(customer)).rejects.toBeInstanceOf(AccountingError);
  });

  it("oppretter kunde og faktura med ørebeløp og idempotensheader", async () => {
    vi.stubEnv("FIKEN_TOKEN", "fiken-token");
    vi.stubEnv("FIKEN_COMPANY_SLUG", "demo");
    vi.stubEnv("FIKEN_BANK_ACCOUNT", "1920:10001");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(created("https://api.fiken.no/api/v2/companies/demo/contacts/123"))
      .mockResolvedValueOnce(
        created("https://api.fiken.no/api/v2/companies/demo/invoices/999", {
          invoiceNumber: 501,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const contact = await fikenProvider.syncCustomer(customer);
    expect(contact.externalId).toBe("123");
    const contactInit = fetchMock.mock.calls[0][1];
    expect(contactInit.headers["Fiken-Request-Id"]).toBe("fsm-customer-cust-1");
    const contactBody = JSON.parse(contactInit.body);
    expect(contactBody).toMatchObject({ name: "Kunde AS", customer: true });
    expect(contactBody.address).toMatchObject({ city: "Oslo", country: "Norge" });

    const result = await fikenProvider.syncInvoice(invoice);
    expect(result).toMatchObject({
      externalId: "999",
      externalNumber: "501",
      mode: "api",
    });
    const invoiceBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(invoiceBody).toMatchObject({
      customerId: 123,
      bankAccountCode: "1920:10001",
      cash: false,
      currency: "NOK",
    });
    expect(invoiceBody.lines[0]).toMatchObject({
      unitPrice: 10000,
      quantity: 2,
      vatInPercent: 25,
    });
  });

  it("bokfører betaling som journalpost og krever kontokoder", async () => {
    vi.stubEnv("FIKEN_TOKEN", "fiken-token");
    vi.stubEnv("FIKEN_COMPANY_SLUG", "demo");
    vi.stubEnv("FIKEN_PAYMENT_DEBIT_ACCOUNT", "");
    vi.stubEnv("FIKEN_PAYMENT_CREDIT_ACCOUNT", "");
    await expect(fikenProvider.recordPayment(payment)).rejects.toMatchObject({
      code: "not_configured",
    });

    vi.stubEnv("FIKEN_PAYMENT_DEBIT_ACCOUNT", "1920:10001");
    vi.stubEnv("FIKEN_PAYMENT_CREDIT_ACCOUNT", "1500:10001");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        created("https://api.fiken.no/api/v2/companies/demo/generalJournalEntries/77"),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fikenProvider.recordPayment(payment);
    expect(result.externalId).toBe("77");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.journalEntries[0].lines).toEqual([
      { amount: 25000, debitAccount: "1920:10001" },
      { amount: 25000, creditAccount: "1500:10001" },
    ]);
  });
});

describe("Tripletex-konnektor", () => {
  it("oppretter ordre og faktura og registrerer betaling", async () => {
    vi.stubEnv("TRIPLETEX_TOKEN", "tripletex-token");
    vi.stubEnv("TRIPLETEX_PAYMENT_TYPE_ID", "42");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ value: { id: 55 } }))
      .mockResolvedValueOnce(json({ value: { id: 77, invoiceNumber: 1001 } }))
      .mockResolvedValueOnce(json({ value: { id: 77 } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await tripletexProvider.syncInvoice(invoice);
    expect(result).toMatchObject({ externalId: "77", externalNumber: "1001" });
    expect(fetchMock.mock.calls[0][0]).toContain("/order");
    expect(fetchMock.mock.calls[1][0]).toContain("/invoice");
    const order = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(order.orderLines[0]).toMatchObject({
      unitPriceExcludingVatCurrency: 100,
      count: 2,
    });

    const paid = await tripletexProvider.recordPayment(payment);
    expect(paid.externalId).toBe("77");
    expect(fetchMock.mock.calls[2][0]).toContain("/invoice/999/:payment?");
    expect(fetchMock.mock.calls[2][0]).toContain("paymentTypeId=42");
    expect(fetchMock.mock.calls[2][0]).toContain("amount=250.00");
  });

  it("krever betalingstype for betaling", async () => {
    vi.stubEnv("TRIPLETEX_TOKEN", "tripletex-token");
    vi.stubEnv("TRIPLETEX_PAYMENT_TYPE_ID", "");
    await expect(tripletexProvider.recordPayment(payment)).rejects.toMatchObject({
      code: "not_configured",
    });
  });
});

describe("PowerOffice Go-konnektor", () => {
  it("bruker statisk token og PascalCase-felter", async () => {
    vi.stubEnv("POWEROFFICE_TOKEN", "poweroffice-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ Id: 321 }))
      .mockResolvedValueOnce(json({ Id: 654, InvoiceNo: 9001 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await powerOfficeProvider.syncCustomer(customer);
    expect(result.externalId).toBe("321");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      Name: "Kunde AS",
      OrganizationNumber: "999888777",
      MailAddress: { City: "Oslo", CountryCode: "NO" },
    });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer poweroffice-token",
    );

    const invoiceResult = await powerOfficeProvider.syncInvoice(invoice);
    expect(invoiceResult).toMatchObject({ externalId: "654", externalNumber: "9001" });
  });
});

describe("CSV-fallback", () => {
  it("eksporterer deterministisk uten nettverkskall", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const first = await csvProvider.syncInvoice(invoice);
    const second = await csvProvider.syncInvoice(invoice);
    expect(first.mode).toBe("export");
    expect(first.externalId).toBe("csv-invoice:inv-1");
    expect(first.csv).toBe(second.csv);
    expect(first.csv).toContain("F-2026-00001");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rapporterer eksportmodus i testen", async () => {
    await expect(csvProvider.testConnection()).resolves.toMatchObject({
      ok: true,
      message: "export_only",
    });
  });
});
