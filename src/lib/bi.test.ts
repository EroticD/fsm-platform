import { describe, expect, it } from "vitest";
import {
  buildBiCsv,
  biCsvFileName,
  computeCapacityMinutes,
  firstTimeFixOutcome,
  hourlyRateOreForItems,
  netInvoiceRevenueOre,
  normalizeBiFilters,
  summarizeProfitability,
  type BiInvoice,
  type BiOrder,
  type BiStaff,
  type BiSummary,
} from "./bi";

const VISIT = {
  startsAt: new Date("2026-11-02T08:00:00.000Z"),
  enRouteAt: new Date("2026-11-02T08:00:00.000Z"),
  onSiteAt: new Date("2026-11-02T08:10:00.000Z"),
  doneAt: new Date("2026-11-02T09:10:00.000Z"),
  travelFromEndedAt: new Date("2026-11-02T09:25:00.000Z"),
  technicianIds: ["tech-1"],
};

function order(overrides: Partial<BiOrder> = {}): BiOrder {
  return {
    id: "wo-1",
    reference: "O-1",
    title: "Service",
    status: "COMPLETED",
    scheduledFor: new Date("2026-11-02T00:00:00.000Z"),
    departmentId: "dep-a",
    departmentName: "Hovedavdeling",
    customerId: "cust-1",
    customerName: "Kunde AS",
    technicians: [{ id: "tech-1", name: "Ola Montør" }],
    visits: [VISIT],
    reportStatuses: ["GODKJENT"],
    deviationRemediation: false,
    priceItems: [{ code: "TIME", unit: "time", amount: 1000 }],
    ...overrides,
  };
}

const staff: BiStaff[] = [
  {
    id: "tech-1",
    name: "Ola Montør",
    departmentId: "dep-a",
    availability: [{ weekday: 0, startMinute: 480, endMinute: 960 }],
  },
  {
    id: "tech-2",
    name: "Kari Montør",
    departmentId: "dep-a",
    availability: [{ weekday: 0, startMinute: 480, endMinute: 960 }],
  },
];

const filters = {
  from: "2026-11-02",
  to: "2026-11-02",
  departmentId: null,
  customerId: null,
  technicianId: null,
};

const options = {
  departments: [{ id: "dep-a", name: "Hovedavdeling" }],
  customers: [{ id: "cust-1", name: "Kunde AS" }],
  technicians: [
    { id: "tech-1", name: "Ola Montør" },
    { id: "tech-2", name: "Kari Montør" },
  ],
};

function summary(orders: BiOrder[], costRate: number | null = null): BiSummary {
  return summarizeProfitability({
    orders,
    staff,
    capacityPlans: [],
    businessHours: [],
    filters,
    options,
    costRateOrePerHour: costRate,
  });
}

function summaryWithInvoices(
  orders: BiOrder[],
  invoices: BiInvoice[],
  invoicingEnabled = true,
): BiSummary {
  return summarizeProfitability({
    orders,
    staff,
    capacityPlans: [],
    businessHours: [],
    filters,
    options,
    invoices,
    invoicingEnabled,
  });
}

function invoice(overrides: Partial<BiInvoice> = {}): BiInvoice {
  return {
    id: "inv-1",
    workOrderId: "wo-1",
    issueDate: new Date("2026-11-02T00:00:00.000Z"),
    subtotalOre: 100_000,
    creditedNetOre: 0,
    status: "SENT",
    ...overrides,
  };
}

describe("BI-filter", () => {
  it("bruker inneværende måned til og med i dag som standard", () => {
    const result = normalizeBiFilters({}, new Date("2026-11-07T12:00:00.000Z"));
    expect(result).toEqual({
      ok: true,
      data: {
        from: "2026-11-01",
        to: "2026-11-07",
        departmentId: null,
        customerId: null,
        technicianId: null,
      },
    });
  });

  it("avviser ugyldig og omvendt periode", () => {
    expect(normalizeBiFilters({ from: "2026-13-01" }).ok).toBe(false);
    expect(
      normalizeBiFilters({ from: "2026-11-07", to: "2026-11-01" }).ok,
    ).toBe(false);
  });

  it("avviser perioder over ett år", () => {
    expect(
      normalizeBiFilters({ from: "2025-01-01", to: "2026-11-01" }).ok,
    ).toBe(false);
  });
});

describe("timepris fra prisliste", () => {
  it("godtar timeenhet og timekode, men ikke fastpris", () => {
    expect(
      hourlyRateOreForItems([
        { code: "FAST", unit: "stk", amount: 5000 },
        { code: "TIME", unit: "time", amount: 1250.5 },
      ]),
    ).toBe(125050);
    expect(
      hourlyRateOreForItems([{ code: "SERVICE", unit: "stk", amount: 900 }]),
    ).toBeNull();
    expect(hourlyRateOreForItems([])).toBeNull();
  });

  it("velger stabilt ved flere timepriser", () => {
    expect(
      hourlyRateOreForItems([
        { code: "OVERTIME", unit: "time", amount: 2000 },
        { code: "ARBEIDSTIME", unit: "time", amount: 1000 },
      ]),
    ).toBe(100000);
  });
});

describe("first-time-fix", () => {
  it("krever fullført rapport uten avvik", () => {
    expect(firstTimeFixOutcome(order())).toBe("fixed");
    expect(
      firstTimeFixOutcome(order({ reportStatuses: ["AVVIK"] })),
    ).toBe("not_fixed");
    expect(firstTimeFixOutcome(order({ reportStatuses: [] }))).toBe(
      "not_measurable",
    );
    expect(firstTimeFixOutcome(order({ status: "PLANNED" }))).toBe(
      "not_measurable",
    );
    expect(
      firstTimeFixOutcome(
        order({ reportStatuses: ["GODKJENT"], deviationRemediation: true }),
      ),
    ).toBe("not_measurable");
  });
});

describe("kapasitet", () => {
  it("bruker eksplisitt plan foran arbeidstid", () => {
    const result = computeCapacityMinutes(
      staff,
      [
        {
          technicianId: "tech-1",
          departmentId: "dep-a",
          date: new Date("2026-11-02T00:00:00.000Z"),
          capacityMinutes: 240,
        },
      ],
      [],
      "2026-11-02",
      "2026-11-02",
    );

    expect(result.availableMinutes).toBe(240 + 480);
    expect(result.byTechnician).toEqual({ "tech-1": 240, "tech-2": 480 });
    expect(result.basis).toBe("mixed");
  });

  it("faller tilbake til åpningstider og deretter standarddag", () => {
    expect(
      computeCapacityMinutes(
        staff.map((person) => ({ ...person, availability: [] })),
        [],
        [
          {
            departmentId: "dep-a",
            weekday: 0,
            openMinute: 480,
            closeMinute: 900,
          },
        ],
        "2026-11-02",
        "2026-11-02",
      ).availableMinutes,
    ).toBe(420 * 2);

    expect(
      computeCapacityMinutes(
        [{ ...staff[0], availability: [] }],
        [],
        [],
        "2026-11-02",
        "2026-11-02",
      ).availableMinutes,
    ).toBe(480);
  });
});

describe("lønnsomhetssammendrag", () => {
  it("teller oppdrag, status og fullføringsgrad", () => {
    const data = summary([
      order(),
      order({
        id: "wo-2",
        reference: "O-2",
        status: "PLANNED",
        visits: [],
        reportStatuses: [],
      }),
      order({
        id: "wo-3",
        reference: "O-3",
        status: "CANCELLED",
        visits: [],
        reportStatuses: [],
      }),
    ]);

    expect(data.orders).toMatchObject({
      total: 3,
      completed: 1,
      cancelled: 1,
      open: 1,
      completionRate: 33.3,
    });
    expect(data.orders.byStatus).toEqual({
      COMPLETED: 1,
      PLANNED: 1,
      CANCELLED: 1,
    });
  });

  it("inkluderer både arbeid og reise i timetotalene", () => {
    const data = summary([order()]);

    expect(data.time).toMatchObject({
      workMinutes: 60,
      travelToMinutes: 10,
      travelFromMinutes: 15,
      travelMinutes: 25,
      totalMinutes: 85,
      sessions: 1,
      completedSessions: 1,
    });
    expect(data.perTechnician[0]).toMatchObject({
      workMinutes: 60,
      travelMinutes: 25,
      totalMinutes: 85,
    });
  });

  it("måler first-time-fix bare på målbare oppdrag", () => {
    const data = summary([
      order(),
      order({
        id: "wo-2",
        reference: "O-2",
        reportStatuses: ["AVVIK"],
      }),
      order({
        id: "wo-3",
        reference: "O-3",
        reportStatuses: ["GODKJENT"],
        deviationRemediation: true,
      }),
      order({
        id: "wo-4",
        reference: "O-4",
        reportStatuses: [],
      }),
    ]);

    expect(data.firstTimeFix).toEqual({
      eligible: 2,
      fixed: 1,
      rate: 50,
      deviations: 1,
      remediationOrders: 1,
    });
  });

  it("merker inntekt som estimat og faktisk inntekt som utilgjengelig", () => {
    const data = summary([
      order(),
      order({ id: "wo-2", reference: "O-2", priceItems: null }),
    ]);

    expect(data.revenue.actualAvailable).toBe(false);
    expect(data.revenue.actualRevenueOre).toBeNull();
    expect(data.revenue.estimatedRevenueOre).toBe(100_000);
    expect(data.revenue.estimatedRevenueOrders).toBe(1);
    expect(data.revenue.ordersWithoutRate).toBe(1);
    expect(data.revenue.basis).toBe("partial");
    expect(data.revenue.estimatedProfitOre).toBeNull();
    expect(data.revenue.costBasis).toBe("missing");
  });

  it("beregner estimert resultat når alle oppdrag har pris og kostnadssats", () => {
    const data = summary([order()], 50000);

    expect(data.revenue.estimatedCostOre).toBe(70_833);
    expect(data.revenue.estimatedProfitOre).toBe(29_167);
    expect(data.revenue.costBasis).toBe("internal_rate");
  });

  it("fordeler per montør, kunde og oppdrag", () => {
    const data = summary([
      order(),
      order({
        id: "wo-2",
        reference: "O-2",
        customerId: "cust-2",
        customerName: "Annen Kunde",
        technicians: [{ id: "tech-2", name: "Kari Montør" }],
        visits: [{ ...VISIT, technicianIds: ["tech-2"] }],
      }),
    ]);

    expect(data.perTechnician.map((row) => row.id).sort()).toEqual([
      "tech-1",
      "tech-2",
    ]);
    expect(data.perCustomer.map((row) => row.name).sort()).toEqual([
      "Annen Kunde",
      "Kunde AS",
    ]);
    expect(data.perOrder).toHaveLength(2);
    expect(data.perOrder[0]).toMatchObject({
      reference: "O-1",
      workMinutes: 60,
      travelMinutes: 25,
      totalMinutes: 85,
      firstTimeFix: "fixed",
      estimatedRevenueOre: 100_000,
    });
  });

  it("tåler tomt datasett", () => {
    const data = summarizeProfitability({
      orders: [],
      staff: [],
      capacityPlans: [],
      businessHours: [],
      filters,
      options: { departments: [], customers: [], technicians: [] },
    });

    expect(data.orders.total).toBe(0);
    expect(data.orders.completionRate).toBeNull();
    expect(data.firstTimeFix.rate).toBeNull();
    expect(data.time.totalMinutes).toBe(0);
    expect(data.capacity).toMatchObject({
      availableMinutes: 0,
      basis: "none",
      utilizationPercent: null,
    });
    expect(data.revenue.basis).toBe("missing");
    expect(data.revenue.estimatedProfitOre).toBeNull();
    expect(data.perTechnician).toEqual([]);
    expect(data.perCustomer).toEqual([]);
    expect(data.perOrder).toEqual([]);
  });
});

describe("faktisk omsetning", () => {
  it("regner netto uten MVA, trekker fra kreditnota og utelater kladd", () => {
    expect(netInvoiceRevenueOre(invoice())).toBe(100_000);
    expect(
      netInvoiceRevenueOre(invoice({ status: "CREDITED", creditedNetOre: 100_000 })),
    ).toBe(0);
    expect(netInvoiceRevenueOre(invoice({ creditedNetOre: 25_000 }))).toBe(
      75_000,
    );
    expect(netInvoiceRevenueOre(invoice({ status: "DRAFT" }))).toBeNull();
    expect(
      netInvoiceRevenueOre(invoice({ subtotalOre: 0, creditedNetOre: 10_000 })),
    ).toBe(0);
  });

  it("summerer faktisk omsetning per oppdrag, kunde og montør", () => {
    const data = summaryWithInvoices(
      [order(), order({ id: "wo-2", reference: "O-2", customerId: "cust-2", customerName: "Annen Kunde" })],
      [
        invoice({ subtotalOre: 80_000 }),
        invoice({ id: "inv-2", workOrderId: "wo-2", subtotalOre: 50_000 }),
      ],
    );

    expect(data.revenue.actualAvailable).toBe(true);
    expect(data.revenue.actualRevenueOre).toBe(130_000);
    expect(data.revenue.actualInvoiceCount).toBe(2);
    expect(data.revenue.actualOrderCount).toBe(2);
    expect(data.perOrder.map((row) => row.actualRevenueOre)).toEqual([
      80_000,
      50_000,
    ]);
    expect(
      data.perCustomer.find((row) => row.id === "cust-1")?.actualRevenueOre,
    ).toBe(80_000);
    expect(
      data.perCustomer.find((row) => row.id === "cust-2")?.actualRevenueOre,
    ).toBe(50_000);
  });

  it("fordeler delt oppdrag til laveste montør-id uten dobbelttelling", () => {
    const shared = order({
      technicians: [
        { id: "tech-2", name: "Kari Montør" },
        { id: "tech-1", name: "Ola Montør" },
      ],
    });
    const data = summaryWithInvoices([shared], [invoice()]);

    expect(data.revenue.actualRevenueOre).toBe(100_000);
    expect(
      data.perTechnician.find((row) => row.id === "tech-1")?.actualRevenueOre,
    ).toBe(100_000);
    expect(
      data.perTechnician.find((row) => row.id === "tech-2")?.actualRevenueOre,
    ).toBe(0);
    expect(
      data.perTechnician.reduce(
        (sum, row) => sum + (row.actualRevenueOre ?? 0),
        0,
      ),
    ).toBe(data.revenue.actualRevenueOre);
  });

  it("gir utilgjengelig faktisk omsetning når modulen er av eller utvalget er tomt", () => {
    const empty = summaryWithInvoices([order()], []);
    expect(empty.revenue.actualAvailable).toBe(false);
    expect(empty.revenue.actualRevenueOre).toBeNull();
    expect(empty.revenue.actualInvoiceCount).toBe(0);
    expect(empty.perOrder[0].actualRevenueOre).toBeNull();

    const disabled = summaryWithInvoices([order()], [invoice()], false);
    expect(disabled.revenue.actualAvailable).toBe(false);
    expect(disabled.revenue.actualRevenueOre).toBeNull();
    expect(disabled.perOrder[0].actualRevenueOre).toBeNull();

    const draftOnly = summaryWithInvoices(
      [order()],
      [invoice({ status: "DRAFT" })],
    );
    expect(draftOnly.revenue.actualAvailable).toBe(false);
  });

  it("ignorerer fakturaer som ikke hører til et oppdrag i utvalget", () => {
    const data = summaryWithInvoices(
      [order()],
      [invoice({ workOrderId: "wo-outside" }), invoice({ workOrderId: null })],
    );

    expect(data.revenue.actualAvailable).toBe(false);
    expect(data.revenue.actualRevenueOre).toBeNull();
  });

  it("skriver faktisk omsetning og tilgjengelighet i CSV", () => {
    const data = summaryWithInvoices([order()], [invoice()]);
    const csv = buildBiCsv(data);

    expect(csv).toContain("Faktisk inntekt (NOK)");
    expect(csv).toContain("Faktisk tilgjengelig");
    expect(csv).toContain("1000.00");
    expect(csv).toContain("ja");
  });
});

describe("CSV-eksport", () => {
  it("nøytraliserer formelinjeksjon og er deterministisk", () => {
    const data = summary([
      order({
        customerName: "=SUM(1;2)",
        title: "@farlig",
        reference: "+O-1",
      }),
    ]);

    const first = buildBiCsv(data);
    const second = buildBiCsv(data);

    expect(first).toBe(second);
    expect(first.startsWith("\uFEFF")).toBe(true);
    expect(first).toContain("\"'=SUM(1;2)\"");
    expect(first).toContain("\"'@farlig\"");
    expect(first).toContain("\"'+O-1\"");
    expect(first).toContain("Sammendrag");
    expect(first).toContain("Tekniker");
    expect(first).toContain("Kunde");
    expect(first).toContain("Oppdrag");
  });

  it("gir et stabilt filnavn basert på filteret", () => {
    expect(biCsvFileName({ ...filters, from: "2026-11-01", to: "2026-11-30" })).toBe(
      "lonnsomhet-2026-11-01-2026-11-30.csv",
    );
  });
});
