#!/usr/bin/env node
/**
 * Demo-seed for utviklings- og testdatabaser.
 *
 * Skriptet fyller P2-modulene (tilbud, faktura, lager og utlegg) med et lite,
 * realistisk datasett, slik at utvikling og QA slipper å klikke seg fram til
 * data. Det er laget for `npm run seed`-flyten og forutsetter at migreringene
 * er kjørt og at standardavdelingen finnes (den opprettes ved behov).
 *
 * Sikkerhet og idempotens:
 *   - Nekter å kjøre når NODE_ENV=production.
 *   - Nekter å kjøre uten SEED_DEMO_CONFIRM=ja.
 *   - Skriver bare rader med faste demo-id-er. Ingenting slettes, og rader som
 *     ikke er demo-rader røres ikke. Kjøringen kan derfor gjentas fritt.
 *
 *   SEED_DEMO_CONFIRM=ja npm run seed:demo
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

/** Verdien som må stå i SEED_DEMO_CONFIRM for å bekrefte en bevisst kjøring. */
const CONFIRM_VALUE = "ja";

function refuse(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  refuse(
    "Demo-seeden nekter å kjøre i produksjon. Den er bare for utviklings- og testdatabaser.",
  );
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  refuse("DATABASE_URL må være satt for å kjøre demo-seeden.");
}

if (process.env.SEED_DEMO_CONFIRM !== CONFIRM_VALUE) {
  console.error(
    "✖ Demo-seeden skriver demokunder, -oppdrag og -fakturaer og krever derfor et eksplisitt ja.",
  );
  console.error(`  Kjør med SEED_DEMO_CONFIRM=${CONFIRM_VALUE} foran kommandoen:`);
  console.error(`    SEED_DEMO_CONFIRM=${CONFIRM_VALUE} npm run seed:demo`);
  console.error("  Bruk den bare mot utviklings- eller testdatabaser.");
  process.exit(1);
}

const url = new URL(connectionString);
const schema = url.searchParams.get("schema") ?? undefined;
url.searchParams.delete("schema");
const databaseLabel = `${url.pathname.replace(/^\//, "") || "ukjent database"}@${url.host}`;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
});

/** Faste id-er. De gjør hver kjøring idempotent uten å slette noe først. */
const ID = {
  location: "seed-demo-location-lager",
  customer: "seed-demo-customer-nordvik",
  contactPrimary: "seed-demo-contact-kari",
  contactSecondary: "seed-demo-contact-ola",
  product: "seed-demo-product-pa400",
  contract: "seed-demo-contract-service",
  workOrderOpen: "seed-demo-workorder-open",
  workOrderDone: "seed-demo-workorder-done",
  visitOpen: "seed-demo-visit-open",
  visitDone: "seed-demo-visit-done",
  report: "seed-demo-report-done",
  quote: "seed-demo-quote-portmotor",
  quoteLine1: "seed-demo-quote-line-1",
  quoteLine2: "seed-demo-quote-line-2",
  invoice: "seed-demo-invoice-service",
  invoiceLine1: "seed-demo-invoice-line-1",
  invoiceLine2: "seed-demo-invoice-line-2",
  inventoryItem: "seed-demo-item-portmotor",
  stockMovement: "seed-demo-stock-movement-in",
  expense: "seed-demo-expense-parking",
} as const;

const DEMO_USERS = {
  admin: {
    email: "demo.admin@example.test",
    name: "Demo Administrator",
    role: "ADMIN" as const,
    password: "DemoAdmin123!",
  },
  office: {
    email: "demo.kontor@example.test",
    name: "Demo Kontor",
    role: "OFFICE" as const,
    password: "DemoKontor123!",
  },
  technician: {
    email: "demo.montor@example.test",
    name: "Demo Montør",
    role: "TECHNICIAN" as const,
    password: "DemoMontor123!",
  },
};

const CREATED: string[] = [];
const REUSED: string[] = [];

/**
 * Sjekker om raden finnes før den skrives, slik at oppsummeringen kan skille
 * mellom nye og eksisterende demo-rader. Skrivingen er alltid en upsert.
 */
async function track<T>(
  label: string,
  exists: Promise<unknown | null>,
  write: () => Promise<T>,
): Promise<T> {
  const found = await exists;
  const row = await write();
  (found ? REUSED : CREATED).push(label);
  return row;
}

/** Dagens lokal dato som UTC-midnatt, med valgfritt antall dager forskyvning. */
function dateOnly(offsetDays = 0): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays),
  );
}

function dateTimeAtNoon(offsetDays = 0): Date {
  return new Date(dateOnly(offsetDays).getTime() + 12 * 60 * 60 * 1000);
}

/** `O-YYMMDD-XXXXXXXX`-referanse med fast suffiks, slik at den er gjenkjennelig. */
function workOrderReference(suffix: string): string {
  const date = dateOnly(0).toISOString().slice(2, 10).replace(/-/g, "");
  return `O-${date}-${suffix}`;
}

/** Avrundet linje- og dokumenttotal, som `calculateDocument` i src/lib/billing. */
function lineAmounts(quantity: number, unitPrice: number, vatRate: number) {
  const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
  const lineVat = Math.round(lineTotal * vatRate) / 100;
  return {
    lineTotal: lineTotal.toFixed(2),
    lineVat: lineVat.toFixed(2),
  };
}

function sumLines(lines: ReadonlyArray<{ lineTotal: string; lineVat: string }>) {
  const subtotal = lines.reduce((sum, line) => sum + Number(line.lineTotal), 0);
  const vatTotal = lines.reduce((sum, line) => sum + Number(line.lineVat), 0);
  return {
    subtotal: subtotal.toFixed(2),
    vatTotal: vatTotal.toFixed(2),
    total: (subtotal + vatTotal).toFixed(2),
  };
}

/**
 * Sørger for én bruker per rolle. En demo-bruker med fast e-post gjenbrukes;
 * ellers gjenbrukes en eksisterende aktiv bruker med rollen, så seeden aldri
 * lager duplikatkontoer i en database som alt har ansatte.
 */
async function ensureRoleUser(spec: (typeof DEMO_USERS)[keyof typeof DEMO_USERS]) {
  const byEmail = await prisma.user.findUnique({ where: { email: spec.email } });
  if (byEmail) {
    REUSED.push(`${spec.role.toLowerCase()}: ${byEmail.email}`);
    return byEmail;
  }

  const sameRole = await prisma.user.findFirst({
    where: { role: spec.role, isActive: true },
    orderBy: { id: "asc" },
  });
  if (sameRole) {
    REUSED.push(
      `${spec.role.toLowerCase()}: ${sameRole.name ?? "(uten navn)"} <${sameRole.email ?? "uten e-post"}>`,
    );
    return sameRole;
  }

  const created = await prisma.user.create({
    data: {
      email: spec.email,
      name: spec.name,
      password: await bcrypt.hash(spec.password, 10),
      role: spec.role,
      isActive: true,
      emailVerified: new Date(),
    },
  });
  CREATED.push(
    `${spec.role.toLowerCase()}: ${created.email} (passord ${spec.password})`,
  );
  return created;
}

async function main() {
  console.log(`→ Demo-seed mot ${databaseLabel} (NODE_ENV=${process.env.NODE_ENV ?? "utvikling"}).`);
  console.log("  Skriver bare demo-rader med faste id-er. Ingenting slettes.");

  // --- Avdeling -----------------------------------------------------------
  let department = await prisma.department.findFirst({
    where: { OR: [{ isDefault: true }, { name: "Hovedavdeling" }] },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  if (department) {
    REUSED.push(`avdeling: ${department.name}`);
  } else {
    department = await prisma.department.create({
      data: {
        name: "Hovedavdeling",
        description: "Standardavdeling opprettet av demo-seeden.",
        isDefault: true,
      },
    });
    CREATED.push(`avdeling: ${department.name}`);
  }

  const roles = await prisma.role.findMany({
    where: { key: { in: ["ADMIN", "OFFICE", "TECHNICIAN"] } },
    select: { key: true },
  });
  if (roles.length < 3) {
    throw new Error(
      "Rolldata mangler (ADMIN/OFFICE/TECHNICIAN). Kjør migreringene først.",
    );
  }

  // --- Brukere ------------------------------------------------------------
  const admin = await ensureRoleUser(DEMO_USERS.admin);
  const office = await ensureRoleUser(DEMO_USERS.office);
  const technician = await ensureRoleUser(DEMO_USERS.technician);
  if (!admin.departmentId || !office.departmentId || !technician.departmentId) {
    for (const user of [admin, office, technician]) {
      if (!user.departmentId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { departmentId: department.id },
        });
      }
    }
  }

  // --- Kunde, kontakter og utstyr ----------------------------------------
  const customer = await track(
    "kunde: Nordvik Demo Industri AS",
    prisma.customer.findUnique({ where: { id: ID.customer }, select: { id: true } }),
    () =>
      prisma.customer.upsert({
        where: { id: ID.customer },
        update: {
          departmentId: department.id,
          responsibleTechnicianId: technician.id,
        },
        create: {
          id: ID.customer,
          name: "Nordvik Demo Industri AS",
          customerNumber: "DEMO-1001",
          orgNumber: "912345678",
          address: "Demoveien 12",
          postalCode: "0150",
          city: "Oslo",
          phone: "22 00 00 10",
          email: "post@nordvik-demo.example.test",
          departmentId: department.id,
          responsibleTechnicianId: technician.id,
        },
      }),
  );

  const primaryContact = await track(
    "kontakt: Kari Nordvik (driftsleder)",
    prisma.contact.findUnique({
      where: { id: ID.contactPrimary },
      select: { id: true },
    }),
    () =>
      prisma.contact.upsert({
        where: { id: ID.contactPrimary },
        update: {},
        create: {
          id: ID.contactPrimary,
          name: "Kari Nordvik",
          email: "kari.nordvik@nordvik-demo.example.test",
          phone: "22 00 00 11",
          role: "Driftsleder",
          customerId: customer.id,
        },
      }),
  );

  const secondaryContact = await track(
    "kontakt: Ola Fjell (vaktmester)",
    prisma.contact.findUnique({
      where: { id: ID.contactSecondary },
      select: { id: true },
    }),
    () =>
      prisma.contact.upsert({
        where: { id: ID.contactSecondary },
        update: {},
        create: {
          id: ID.contactSecondary,
          name: "Ola Fjell",
          email: "ola.fjell@nordvik-demo.example.test",
          phone: "22 00 00 12",
          role: "Vaktmester",
          customerId: customer.id,
        },
      }),
  );

  const product = await track(
    "utstyr: Portautomatikk PA-400 (NV-4001)",
    prisma.product.findUnique({ where: { id: ID.product }, select: { id: true } }),
    () =>
      prisma.product.upsert({
        where: { id: ID.product },
        update: { customerId: customer.id },
        create: {
          id: ID.product,
          model: "Portautomatikk PA-400",
          serialNumber: "NV-4001",
          location: "Hovedinngang",
          customerId: customer.id,
          qrToken: "seed-demo-qr-pa400-0001",
          meterUnit: "sykluser",
          installDate: dateOnly(-420),
          warrantyUntil: dateOnly(310),
        },
      }),
  );

  // --- Serviceavtale ------------------------------------------------------
  const contract = await track(
    "serviceavtale: Årlig service – porter",
    prisma.contract.findUnique({ where: { id: ID.contract }, select: { id: true } }),
    () =>
      prisma.contract.upsert({
        where: { id: ID.contract },
        update: { nextServiceDate: dateOnly(30) },
        create: {
          id: ID.contract,
          title: "Årlig service – porter",
          contractNumber: "DEMO-AVT-0001",
          intervalMonths: 12,
          startDate: dateOnly(-300),
          nextServiceDate: dateOnly(30),
          status: "ACTIVE",
          isActive: true,
          customerId: customer.id,
          departmentId: department.id,
          contactId: primaryContact.id,
        },
      }),
  );

  // --- Oppdrag ------------------------------------------------------------
  const openWorkOrder = await track(
    "oppdrag: Service – portautomatikk (åpent)",
    prisma.workOrder.findUnique({
      where: { id: ID.workOrderOpen },
      select: { id: true },
    }),
    () =>
      prisma.workOrder.upsert({
        where: { id: ID.workOrderOpen },
        update: {
          technicians: { set: [{ id: technician.id }] },
        },
        create: {
          id: ID.workOrderOpen,
          reference: workOrderReference("DEMO0001"),
          title: "Service – portautomatikk",
          description:
            "Årlig service på portautomatikk. Kunden ønsker kontroll av nødstopp og sikkerhetsbryter.",
          scheduledFor: dateOnly(2),
          status: "OPEN",
          creatorName: admin.name,
          departmentId: department.id,
          customerId: customer.id,
          contactId: primaryContact.id,
          productId: product.id,
          contractId: contract.id,
          technicians: { connect: [{ id: technician.id }] },
        },
      }),
  );

  const completedWorkOrder = await track(
    "oppdrag: Feilsøking – portåpner (fullført)",
    prisma.workOrder.findUnique({
      where: { id: ID.workOrderDone },
      select: { id: true },
    }),
    () =>
      prisma.workOrder.upsert({
        where: { id: ID.workOrderDone },
        update: {
          technicians: { set: [{ id: technician.id }] },
        },
        create: {
          id: ID.workOrderDone,
          reference: workOrderReference("DEMO0002"),
          title: "Feilsøking – portåpner",
          description:
            "Porten stoppet halvveis. Slitedeler ble byttet og anlegget testkjørt.",
          scheduledFor: dateOnly(-7),
          status: "COMPLETED",
          creatorName: admin.name,
          departmentId: department.id,
          customerId: customer.id,
          contactId: secondaryContact.id,
          productId: product.id,
          technicians: { connect: [{ id: technician.id }] },
        },
      }),
  );

  // Én heldagsvisitt per oppdrag, i tråd med arbeidsdagsmodellen.
  const visitFor = (id: string, workOrderId: string, offsetDays: number, done: boolean) =>
    track(
      `visitt: ${id}`,
      prisma.visit.findUnique({ where: { id }, select: { id: true } }),
      () =>
        prisma.visit.upsert({
          where: { id },
          update: {},
          create: {
            id,
            workOrderId,
            startsAt: dateOnly(offsetDays),
            endsAt: dateOnly(offsetDays + 1),
            allDay: true,
            status: done ? "DONE" : "PLANNED",
            ...(done
              ? { doneAt: dateTimeAtNoon(offsetDays), onSiteAt: dateTimeAtNoon(offsetDays) }
              : {}),
          },
        }),
    );

  const openVisit = await visitFor(ID.visitOpen, openWorkOrder.id, 2, false);
  const doneVisit = await visitFor(ID.visitDone, completedWorkOrder.id, -7, true);

  for (const visit of [openVisit, doneVisit]) {
    await prisma.visitTechnician.upsert({
      where: { visitId_userId: { visitId: visit.id, userId: technician.id } },
      update: {},
      create: { visitId: visit.id, userId: technician.id },
    });
  }

  // --- Rapport på det fullførte oppdraget --------------------------------
  const report = await track(
    "rapport: DEMO-R-2001",
    prisma.report.findUnique({ where: { id: ID.report }, select: { id: true } }),
    () =>
      prisma.report.upsert({
        where: { id: ID.report },
        update: {},
        create: {
          id: ID.report,
          workOrderId: completedWorkOrder.id,
          dataJson: JSON.stringify({
            status: "GODKJENT",
            answers: {
              Tilstand: "Slitedeler byttet",
              Resultat: "OK",
              Merknad: "Porten går jevnt etter justering av endestopper.",
            },
          }),
          comments: "Anlegget er testkjørt 10 ganger uten avvik.",
          name: "Feilsøking – portåpner",
          reportNumber: "DEMO-R-2001",
          requiresUnits: false,
          templateCategory: "SERVICE",
          completedAt: dateTimeAtNoon(-7),
          isLocked: true,
          lockedAt: dateTimeAtNoon(-7),
          lockedByName: technician.name ?? "Demo Montør",
          technicianName: technician.name ?? "Demo Montør",
          customerName: secondaryContact.name,
        },
      }),
  );

  // --- Tilbud med to linjer ----------------------------------------------
  const quoteLines = [
    {
      id: ID.quoteLine1,
      description: "Arbeid – service og justering av portautomatikk",
      quantity: 4,
      unit: "time",
      unitPrice: 950,
    },
    {
      id: ID.quoteLine2,
      description: "Portmotor PM-500 inkl. montering",
      quantity: 1,
      unit: "stk",
      unitPrice: 4250,
    },
  ].map((line, index) => ({
    ...line,
    sortOrder: index,
    ...lineAmounts(line.quantity, line.unitPrice, 25),
  }));
  const quoteTotals = sumLines(quoteLines);

  const quote = await track(
    "tilbud: Utskifting av portmotor (2 linjer)",
    prisma.quote.findUnique({ where: { id: ID.quote }, select: { id: true } }),
    () =>
      prisma.quote.upsert({
        where: { id: ID.quote },
        update: {},
        create: {
          id: ID.quote,
          quoteNumber: `T-${dateOnly(0).toISOString().slice(2, 10).replace(/-/g, "")}-DEMO01`,
          title: "Utskifting av portmotor",
          status: "SENT",
          version: 1,
          customerId: customer.id,
          contactId: primaryContact.id,
          workOrderId: openWorkOrder.id,
          contractId: contract.id,
          productId: product.id,
          departmentId: department.id,
          currency: "NOK",
          subtotal: quoteTotals.subtotal,
          vatTotal: quoteTotals.vatTotal,
          total: quoteTotals.total,
          vatRate: "25",
          validUntil: dateOnly(28),
          notes: "Prisen forutsetter at eksisterende motor kan leveres til gjenvinning.",
          createdById: admin.id,
          createdByName: admin.name,
          sentAt: dateTimeAtNoon(-2),
        },
      }),
  );

  for (const line of quoteLines) {
    await track(
      `tilbudslinje: ${line.description}`,
      prisma.quoteLine.findUnique({ where: { id: line.id }, select: { id: true } }),
      () =>
        prisma.quoteLine.upsert({
          where: { id: line.id },
          update: {},
          create: {
            id: line.id,
            quoteId: quote.id,
            sortOrder: line.sortOrder,
            description: line.description,
            quantity: line.quantity.toFixed(2),
            unit: line.unit,
            unitPrice: line.unitPrice.toFixed(2),
            vatRate: "25",
            lineTotal: line.lineTotal,
            lineVat: line.lineVat,
          },
        }),
    );
  }

  // --- Ubetalt faktura ----------------------------------------------------
  const invoiceLines = [
    {
      id: ID.invoiceLine1,
      description: "Servicebesøk – feilsøking og utbedring",
      quantity: 3,
      unit: "time",
      unitPrice: 950,
    },
    {
      id: ID.invoiceLine2,
      description: "Materiell – slitedeler og smøremiddel",
      quantity: 1,
      unit: "stk",
      unitPrice: 640,
    },
  ].map((line, index) => ({
    ...line,
    sortOrder: index,
    ...lineAmounts(line.quantity, line.unitPrice, 25),
  }));
  const invoiceTotals = sumLines(invoiceLines);

  const invoice = await track(
    "faktura: ubetalt servicefaktura",
    prisma.invoice.findUnique({ where: { id: ID.invoice }, select: { id: true } }),
    () =>
      prisma.invoice.upsert({
        where: { id: ID.invoice },
        update: {},
        create: {
          id: ID.invoice,
          invoiceNumber: `F-${dateOnly(-7).getUTCFullYear()}-90001`,
          status: "SENT",
          customerId: customer.id,
          contactId: secondaryContact.id,
          departmentId: department.id,
          workOrderId: completedWorkOrder.id,
          reportId: report.id,
          currency: "NOK",
          subtotal: invoiceTotals.subtotal,
          vatTotal: invoiceTotals.vatTotal,
          total: invoiceTotals.total,
          paidTotal: "0.00",
          creditedTotal: "0.00",
          outstanding: invoiceTotals.total,
          vatRate: "25",
          issueDate: dateOnly(-7),
          dueDate: dateOnly(7),
          notes: "Demo: fakturaen er sendt men ikke betalt.",
          createdById: office.id,
          createdByName: office.name,
          sentAt: dateTimeAtNoon(-7),
        },
      }),
  );

  for (const line of invoiceLines) {
    await track(
      `fakturalinje: ${line.description}`,
      prisma.invoiceLine.findUnique({ where: { id: line.id }, select: { id: true } }),
      () =>
        prisma.invoiceLine.upsert({
          where: { id: line.id },
          update: {},
          create: {
            id: line.id,
            invoiceId: invoice.id,
            sortOrder: line.sortOrder,
            description: line.description,
            quantity: line.quantity.toFixed(2),
            unit: line.unit,
            unitPrice: line.unitPrice.toFixed(2),
            vatRate: "25",
            lineTotal: line.lineTotal,
            lineVat: line.lineVat,
          },
        }),
    );
  }

  // --- Lager --------------------------------------------------------------
  const location = await track(
    "lagerlokasjon: Demo hovedlager",
    prisma.inventoryLocation.findUnique({
      where: { id: ID.location },
      select: { id: true },
    }),
    () =>
      prisma.inventoryLocation.upsert({
        where: { id: ID.location },
        update: {},
        create: {
          id: ID.location,
          name: "Demo hovedlager",
          type: "WAREHOUSE",
          departmentId: department.id,
          isActive: true,
        },
      }),
  );

  const inventoryItem = await track(
    "lagerartikkel: Portmotor PM-500 (DEMO-PM500)",
    prisma.inventoryItem.findUnique({
      where: { id: ID.inventoryItem },
      select: { id: true },
    }),
    () =>
      prisma.inventoryItem.upsert({
        where: { id: ID.inventoryItem },
        update: {},
        create: {
          id: ID.inventoryItem,
          sku: "DEMO-PM500",
          name: "Portmotor PM-500",
          unit: "stk",
          minLevel: "5.000",
          active: true,
          description: "Motorenhet for portautomatikk, 400 V.",
        },
      }),
  );

  await track(
    "beholdning: 12 stk Portmotor PM-500 på Demo hovedlager",
    prisma.stockLevel.findUnique({
      where: {
        itemId_locationId: {
          itemId: inventoryItem.id,
          locationId: location.id,
        },
      },
      select: { id: true },
    }),
    () =>
      prisma.stockLevel.upsert({
        where: {
          itemId_locationId: {
            itemId: inventoryItem.id,
            locationId: location.id,
          },
        },
        update: {},
        create: {
          itemId: inventoryItem.id,
          locationId: location.id,
          quantity: "12.000",
        },
      }),
  );

  await track(
    "lagerbevegelse: IN 12 stk Portmotor PM-500",
    prisma.stockMovement.findUnique({
      where: { id: ID.stockMovement },
      select: { id: true },
    }),
    () =>
      prisma.stockMovement.upsert({
        where: { id: ID.stockMovement },
        update: {},
        create: {
          id: ID.stockMovement,
          itemId: inventoryItem.id,
          locationId: location.id,
          type: "IN",
          quantity: "12.000",
          reason: "Demo: varemottak fra leverandør",
          userId: technician.id,
        },
      }),
  );

  // --- Utlegg -------------------------------------------------------------
  await track(
    "utlegg: parkering (240 kr, til godkjenning)",
    prisma.expense.findUnique({ where: { id: ID.expense }, select: { id: true } }),
    () =>
      prisma.expense.upsert({
        where: { id: ID.expense },
        update: {},
        create: {
          id: ID.expense,
          userId: technician.id,
          departmentId: department.id,
          workOrderId: completedWorkOrder.id,
          date: dateOnly(-3),
          category: "Reise",
          description: "Parkeringsavgift ved serviceoppdrag hos Nordvik Demo Industri.",
          amount: "240.00",
          vatAmount: "48.00",
          status: "PENDING",
          submittedAt: dateTimeAtNoon(-3),
        },
      }),
  );

  // --- Oppsummering -------------------------------------------------------
  const counts = {
    kontakter: await prisma.contact.count({
      where: { id: { in: [ID.contactPrimary, ID.contactSecondary] } },
    }),
    oppdrag: await prisma.workOrder.count({
      where: { id: { in: [ID.workOrderOpen, ID.workOrderDone] } },
    }),
    tilbudslinjer: await prisma.quoteLine.count({
      where: { id: { in: [ID.quoteLine1, ID.quoteLine2] } },
    }),
    fakturalinjer: await prisma.invoiceLine.count({
      where: { id: { in: [ID.invoiceLine1, ID.invoiceLine2] } },
    }),
    rapporter: await prisma.report.count({ where: { id: ID.report } }),
    lagerbeholdning: await prisma.stockLevel.count({
      where: {
        itemId: ID.inventoryItem,
        locationId: ID.location,
      },
    }),
    utlegg: await prisma.expense.count({ where: { id: ID.expense } }),
  };

  console.log("\n✔ Demo-seed ferdig.");
  console.log(`\n  Opprettet (${CREATED.length}):`);
  for (const label of CREATED) console.log(`    + ${label}`);
  console.log(`\n  Fantes fra før (${REUSED.length}):`);
  for (const label of REUSED) console.log(`    = ${label}`);
  console.log("\n  Verifisert i databasen:");
  console.log(`    kontakter: ${counts.kontakter}/2`);
  console.log(`    oppdrag: ${counts.oppdrag}/2`);
  console.log(`    tilbudslinjer: ${counts.tilbudslinjer}/2`);
  console.log(`    fakturalinjer: ${counts.fakturalinjer}/2`);
  console.log(`    rapporter: ${counts.rapporter}/1`);
  console.log(`    lagerbeholdning: ${counts.lagerbeholdning}/1`);
  console.log(`    utlegg: ${counts.utlegg}/1`);
  console.log(
    "\n  Demo-e-post: " +
      [admin, office, technician]
        .map((user) => user.email ?? "(uten e-post)")
        .join(", "),
  );
  console.log("  Passord for nyopprettede demobrukere står i docs/TESTING.md.");
}

main()
  .catch((error) => {
    console.error("✖ Demo-seed feilet:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
