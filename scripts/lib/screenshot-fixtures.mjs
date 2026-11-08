/**
 * Felles oppslag og demofiksturer for skjermbildeskriptene.
 *
 * Alle rader er fiktive demo-data i den isolerte E2E-databasen. Funksjonene er
 * idempotente: en fast nøkkel (tilbudsnummer, fakturanummer, SKU eller
 * beskrivelse) gjenbrukes hvis raden finnes fra før.
 */

function dateOnly(offsetDays = 0) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Slår opp radene E2E-seeden lager, og feiler tydelig hvis de mangler. */
export async function resolveFixtures(prisma) {
  const workOrders = await prisma.workOrder.findMany({
    where: {
      title: {
        in: [
          "Service – automatiske dører",
          "Feilsøking – portåpner",
          "Service – kjøleanlegg",
        ],
      },
    },
    select: { id: true, title: true },
  });
  const workOrderByTitle = new Map(
    workOrders.map((workOrder) => [workOrder.title, workOrder.id]),
  );

  const customer = await prisma.customer.findFirst({
    where: { name: "Nordvik Testindustri AS" },
    select: { id: true, name: true, departmentId: true },
  });
  const product = await prisma.product.findFirst({
    where: { model: "Portautomatikk PA-400" },
    select: { id: true, model: true },
  });
  const folder = await prisma.documentFolder.findFirst({
    where: { name: "Driftshåndbøker" },
    select: { id: true, name: true },
  });
  const document = await prisma.document.findFirst({
    where: { title: { startsWith: "Bruksanvisning" } },
    select: { id: true, title: true },
  });
  const template = await prisma.template.findFirst({
    where: { title: "Service av porter" },
    select: { id: true, title: true },
  });
  const department =
    (customer?.departmentId
      ? await prisma.department.findUnique({
          where: { id: customer.departmentId },
          select: { id: true, name: true },
        })
      : null) ??
    (await prisma.department.findFirst({
      where: { isDefault: true },
      select: { id: true, name: true },
    })) ??
    (await prisma.department.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }));
  const admin = await prisma.user.findFirst({
    where: { email: "admin@example.test" },
    select: { id: true, name: true },
  });
  const technician = await prisma.user.findFirst({
    where: { email: "montor@example.test" },
    select: { id: true, name: true },
  });

  const technicianOrderId = workOrderByTitle.get("Service – automatiske dører");
  const detailOrderId = workOrderByTitle.get("Feilsøking – portåpner");
  const reportedOrderId = workOrderByTitle.get("Service – kjøleanlegg");

  const report = reportedOrderId
    ? await prisma.report.findFirst({
        where: { workOrderId: reportedOrderId },
        select: { id: true, workOrderId: true },
        orderBy: { createdAt: "asc" },
      })
    : null;

  const missing = [];
  if (!technicianOrderId) missing.push("oppdraget «Service – automatiske dører»");
  if (!detailOrderId) missing.push("oppdraget «Feilsøking – portåpner»");
  if (!reportedOrderId) missing.push("oppdraget «Service – kjøleanlegg»");
  if (!customer) missing.push("kunden «Nordvik Testindustri AS»");
  if (!product) missing.push("enheten «Portautomatikk PA-400»");
  if (!folder) missing.push("mappen «Driftshåndbøker»");
  if (!document) missing.push("dokumentet «Bruksanvisning …»");
  if (!template) missing.push("malen «Service av porter»");
  if (!report) missing.push("rapporten for «Service – kjøleanlegg»");
  if (!department) missing.push("en avdeling");
  if (!admin) missing.push("administratorbrukeren admin@example.test");
  if (!technician) missing.push("montørbrukeren montor@example.test");
  if (missing.length > 0) {
    throw new Error(
      `E2E-seeden mangler forventede rader: ${missing.join(", ")}. ` +
        "Kjør `npm run seed:e2e` mot databasen først.",
    );
  }

  return {
    technicianOrderId,
    detailOrderId,
    reportedOrderId,
    reportId: report.id,
    customerId: customer.id,
    customerName: customer.name,
    productId: product.id,
    productName: product.model,
    folderId: folder.id,
    folderName: folder.name,
    documentId: document.id,
    documentTitle: document.title,
    templateId: template.id,
    templateTitle: template.title,
    departmentId: department.id,
    departmentName: department.name,
    adminUserId: admin.id,
    technicianUserId: technician.id,
  };
}

/**
 * Sørger for ett demotilbud og én demofaktura. Det gjør tilbuds- og
 * fakturalistene lesbare og gir fakturadetaljen en betalingsflate å fange.
 */
export async function ensureBillingFixtures(prisma, fixtures) {
  const now = new Date();
  const validUntil = dateOnly(30);
  const issueDate = dateOnly(0);
  const dueDate = dateOnly(14);

  let quote = await prisma.quote.findFirst({
    where: { quoteNumber: "DEMO-1001" },
    select: { id: true },
  });
  if (!quote) {
    quote = await prisma.quote.create({
      data: {
        quoteNumber: "DEMO-1001",
        title: "Tilbud – serviceavtale porter",
        status: "SENT",
        customerId: fixtures.customerId,
        customerName: fixtures.customerName,
        departmentId: fixtures.departmentId,
        currency: "NOK",
        subtotal: 12500,
        vatTotal: 3125,
        total: 15625,
        vatRate: 25,
        validUntil,
        notes:
          "Demotilbud for dokumentasjonsbilder. Alle priser og kunder er fiktive.",
        createdById: fixtures.adminUserId,
        createdByName: "Demo Administrator",
        sentAt: now,
        lines: {
          create: [
            {
              sortOrder: 0,
              description: "Årlig service – portautomatikk",
              quantity: 1,
              unit: "stk",
              unitPrice: 9500,
              vatRate: 25,
              lineTotal: 9500,
              lineVat: 2375,
            },
            {
              sortOrder: 1,
              description: "Materialer og smøring",
              quantity: 1,
              unit: "stk",
              unitPrice: 3000,
              vatRate: 25,
              lineTotal: 3000,
              lineVat: 750,
            },
          ],
        },
      },
      select: { id: true },
    });
  }

  let invoice = await prisma.invoice.findFirst({
    where: { invoiceNumber: "DEMO-2001" },
    select: { id: true },
  });
  if (invoice) {
    // Eldre demofakturaer ble laget uten oppdragskobling. BI bruker koblingen
    // til å vise faktisk omsetning, så vi retter den idempotent.
    await prisma.invoice.updateMany({
      where: { invoiceNumber: "DEMO-2001", workOrderId: null },
      data: { workOrderId: fixtures.technicianOrderId },
    });
  }
  if (!invoice) {
    invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: "DEMO-2001",
        status: "SENT",
        customerId: fixtures.customerId,
        departmentId: fixtures.departmentId,
        workOrderId: fixtures.technicianOrderId,
        currency: "NOK",
        subtotal: 12500,
        vatTotal: 3125,
        total: 15625,
        paidTotal: 0,
        creditedTotal: 0,
        outstanding: 15625,
        vatRate: 25,
        issueDate,
        dueDate,
        notes:
          "Demofaktura for dokumentasjonsbilder. Alle beløp og kunder er fiktive.",
        sentAt: now,
        createdById: fixtures.adminUserId,
        createdByName: "Demo Administrator",
        lines: {
          create: [
            {
              sortOrder: 0,
              description: "Service – automatiske dører",
              quantity: 1,
              unit: "stk",
              unitPrice: 9500,
              vatRate: 25,
              lineTotal: 9500,
              lineVat: 2375,
            },
            {
              sortOrder: 1,
              description: "Utskifting av portmotor",
              quantity: 1,
              unit: "stk",
              unitPrice: 3000,
              vatRate: 25,
              lineTotal: 3000,
              lineVat: 750,
            },
          ],
        },
      },
      select: { id: true },
    });
  }

  return { quoteId: quote.id, invoiceId: invoice.id };
}

/**
 * Sørger for lagerlokasjon, vare, leverandør og én innkjøpsordre slik at
 * lager- og innkjøpssidene viser reelle rader i dokumentasjonen.
 */
export async function ensureInventoryFixtures(prisma, fixtures) {
  let location = await prisma.inventoryLocation.findFirst({
    where: { name: "Hovedlager – demo" },
    select: { id: true },
  });
  if (!location) {
    location = await prisma.inventoryLocation.create({
      data: {
        name: "Hovedlager – demo",
        type: "WAREHOUSE",
        departmentId: fixtures.departmentId,
      },
      select: { id: true },
    });
  }

  let item = await prisma.inventoryItem.findFirst({
    where: { sku: "DEMO-PA400" },
    select: { id: true },
  });
  if (!item) {
    item = await prisma.inventoryItem.create({
      data: {
        sku: "DEMO-PA400",
        name: "Portautomatikk PA-400",
        unit: "stk",
        minLevel: 5,
        description:
          "Demovare for dokumentasjonsbilder. Beholdning og priser er fiktive.",
      },
      select: { id: true },
    });
  }

  await prisma.stockLevel.upsert({
    where: {
      itemId_locationId: { itemId: item.id, locationId: location.id },
    },
    update: {},
    create: {
      itemId: item.id,
      locationId: location.id,
      quantity: 12,
    },
  });

  let supplier = await prisma.supplier.findFirst({
    where: { name: "Nordvik Leverandør AS" },
    select: { id: true },
  });
  if (!supplier) {
    supplier = await prisma.supplier.create({
      data: {
        name: "Nordvik Leverandør AS",
        orgNumber: "999888777",
        email: "leverandor@example.test",
        phone: "+47 00 00 00 00",
        departmentId: fixtures.departmentId,
      },
      select: { id: true },
    });
  }

  let purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: { number: "DEMO-PO-2001" },
    select: { id: true },
  });
  if (!purchaseOrder) {
    purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        number: "DEMO-PO-2001",
        status: "ORDERED",
        supplierId: supplier.id,
        locationId: location.id,
        departmentId: fixtures.departmentId,
        expectedAt: dateOnly(7),
        orderedAt: new Date(),
        createdById: fixtures.adminUserId,
        notes: "Demoinnkjøp for dokumentasjonsbilder.",
        lines: {
          create: [
            {
              inventoryItemId: item.id,
              orderedQuantity: 4,
              receivedQuantity: 1,
              unitCost: 1250,
              sortOrder: 0,
            },
          ],
        },
      },
      select: { id: true },
    });
  }

  return {
    locationId: location.id,
    inventoryItemId: item.id,
    supplierId: supplier.id,
    purchaseOrderId: purchaseOrder.id,
  };
}

/**
 * Sørger for én kjøretur og ett utlegg til godkjenning. Begge er fiktive
 * demo-rader som bare brukes av den isolerte E2E-databasen.
 */
export async function ensureExpenseFixtures(prisma, fixtures) {
  let trip = await prisma.mileageTrip.findFirst({
    where: {
      userId: fixtures.technicianUserId,
      fromAddress: "Hovedavdeling",
      toAddress: "Nordvik Testindustri AS",
    },
    select: { id: true },
  });
  if (!trip) {
    trip = await prisma.mileageTrip.create({
      data: {
        userId: fixtures.technicianUserId,
        departmentId: fixtures.departmentId,
        date: dateOnly(0),
        fromAddress: "Hovedavdeling",
        toAddress: "Nordvik Testindustri AS",
        km: 42.5,
        rate: 3.5,
        amount: 148.75,
        purpose: "Service – automatiske dører",
        status: "PENDING",
        submittedAt: new Date(),
      },
      select: { id: true },
    });
  }

  let expense = await prisma.expense.findFirst({
    where: {
      userId: fixtures.technicianUserId,
      description: "Drivstoff – servicebil (demo)",
    },
    select: { id: true },
  });
  if (!expense) {
    expense = await prisma.expense.create({
      data: {
        userId: fixtures.technicianUserId,
        departmentId: fixtures.departmentId,
        date: dateOnly(0),
        category: "Drivstoff",
        description: "Drivstoff – servicebil (demo)",
        amount: 850,
        vatAmount: 170,
        status: "PENDING",
        submittedAt: new Date(),
      },
      select: { id: true },
    });
  }

  return { mileageTripId: trip.id, expenseId: expense.id };
}
