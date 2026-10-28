/**
 * Deterministisk demoseed for den isolerte E2E-databasen.
 *
 * Skriptet nekter å kjøre mot noe annet enn fsm_ui_e2e eller fsm_test, slik at
 * en feil DATABASE_URL ikke kan skrive demo-data i utviklingsdatabasen. Det er
 * idempotent: bare rader med de faste demo-navnene/titlene/e-postene fjernes
 * før de opprettes på nytt. Andre rader røres ikke.
 *
 *   DATABASE_URL=postgresql://.../fsm_ui_e2e node scripts/seed-e2e.mjs
 *
 * CI kan bruke fsm_test. ALLOW_E2E_SEED=1 overstyrer databasenavnsjekken.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✖ DATABASE_URL må være satt for å kjøre E2E-seeden.");
  process.exit(1);
}

const allowAnyDatabase = process.env.ALLOW_E2E_SEED === "1";
if (
  !allowAnyDatabase &&
  !connectionString.includes("fsm_ui_e2e") &&
  !connectionString.includes("fsm_test")
) {
  console.error(
    "✖ E2E-seeden nekter å kjøre: DATABASE_URL peker ikke på fsm_ui_e2e eller fsm_test.",
  );
  console.error("  Sett ALLOW_E2E_SEED=1 bare hvis du virkelig vet hva du gjør.");
  process.exit(1);
}

const url = new URL(connectionString);
const schema = url.searchParams.get("schema") ?? undefined;
url.searchParams.delete("schema");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
});

const DEMO = {
  department: "Hovedavdeling",
  users: {
    admin: { email: "admin@example.test", password: "AdminTest123!", role: "ADMIN", name: "Demo Administrator" },
    office: { email: "kontor@example.test", password: "OfficeTest123!", role: "OFFICE", name: "Demo Kontor" },
    technician: { email: "montor@example.test", password: "TechTest123!", role: "TECHNICIAN", name: "Demo Montør" },
    customer: { email: "kunde@example.test", password: "CustomerTest123!", role: "CUSTOMER", name: "Kari Nordvik" },
  },
  customerNames: ["Nordvik Testindustri AS", "Fjordlys Montasje AS", "Sørlandet Demo Service AS"],
  workOrderTitles: [
    "Service – automatiske dører",
    "Årlig service – portautomatikk",
    "Feilsøking – portåpner",
    "HMS-kontroll – trykkbeholder",
    "Kvartalsservice – pumpe",
    "Service – kjøleanlegg",
    "Venter på deler – portmotor",
    "Avlyst service – dør",
  ],
  templateTitles: ["Service av porter", "HMS – trykkbeholder"],
  documentTitles: [
    "Bruksanvisning – portautomatikk.pdf",
    "HMS-sertifikat – trykkbeholder.pdf",
    "Serviceavtale – Nordvik.pdf",
  ],
  folderNames: ["Driftshåndbøker", "Sertifikater"],
  contractTitle: "Serviceavtale – porter",
  notificationPrefix: "e2e-demo:",
};

const SERVICE_FIELDS = [
  { id: "Tilstand", type: "TEXT", label: "Tilstand", required: true },
  {
    id: "Resultat",
    type: "SELECT",
    label: "Resultat",
    required: true,
    options: ["OK", "Må følges opp"],
  },
  { id: "Merknad", type: "TEXTAREA", label: "Merknad", required: false },
];

const HMS_FIELDS = [
  { id: "Trykk", type: "TEXT", label: "Trykk", required: true },
  { id: "Sikkerhetsventil", type: "TEXT", label: "Sikkerhetsventil", required: true },
  { id: "Avvik", type: "TEXTAREA", label: "Avvik", required: false },
];

/** Dagens lokal dato som UTC-midnatt, med valgfritt antall dager forskyvning. */
function dateOnly(offsetDays = 0) {
  const now = new Date();
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays),
  );
}

function dateTimeAtNoon(offsetDays = 0) {
  return new Date(dateOnly(offsetDays).getTime() + 12 * 60 * 60 * 1000);
}

function uploadDirectory() {
  return process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(process.cwd(), "uploads");
}

/** Bygger en liten, gyldig PDF med én side og ett tekstfelt. */
function buildPdf(text) {
  const ascii = text
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "-")
    .replace(/[\\()]/g, "\\$&");
  const stream = `BT /F1 12 Tf 72 760 Td (${ascii}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/**
 * Fjerner bare demo-radene. Id-ene hentes først, slik at revisjonslogg,
 * varsler og opplastingsfiler kan ryddes før fremmednøklene kaskaderer.
 */
async function removePreviousDemoRows() {
  const workOrders = await prisma.workOrder.findMany({
    where: { title: { in: DEMO.workOrderTitles } },
    select: { id: true },
  });
  const documents = await prisma.document.findMany({
    where: { title: { in: DEMO.documentTitles } },
    select: { id: true },
  });
  const users = await prisma.user.findMany({
    where: { email: { in: Object.values(DEMO.users).map((user) => user.email) } },
    select: { id: true },
  });
  const customers = await prisma.customer.findMany({
    where: { name: { in: DEMO.customerNames } },
    select: { id: true },
  });

  const workOrderIds = workOrders.map((row) => row.id);
  const documentIds = documents.map((row) => row.id);
  const userIds = users.map((row) => row.id);
  const customerIds = customers.map((row) => row.id);

  const uploads = documentIds.length
    ? await prisma.upload.findMany({
        where: { ownerType: "DOCUMENT", ownerId: { in: documentIds } },
        select: { storedName: true },
      })
    : [];

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({
      where: { entityType: "WorkOrder", entityId: { in: workOrderIds } },
    });
    await tx.notification.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { dedupeKey: { startsWith: DEMO.notificationPrefix } },
        ],
      },
    });
    await tx.workOrder.deleteMany({ where: { id: { in: workOrderIds } } });
    await tx.contract.deleteMany({
      where: {
        OR: [{ title: DEMO.contractTitle }, { customerId: { in: customerIds } }],
      },
    });
    await tx.user.deleteMany({
      where: { email: { in: Object.values(DEMO.users).map((user) => user.email) } },
    });
    await tx.customer.deleteMany({ where: { name: { in: DEMO.customerNames } } });
    await tx.documentJob.deleteMany({ where: { documentId: { in: documentIds } } });
    await tx.upload.deleteMany({
      where: { ownerType: "DOCUMENT", ownerId: { in: documentIds } },
    });
    await tx.document.deleteMany({ where: { title: { in: DEMO.documentTitles } } });
    await tx.documentFolder.deleteMany({ where: { name: { in: DEMO.folderNames } } });
    await tx.template.deleteMany({ where: { title: { in: DEMO.templateTitles } } });
  });

  const directory = uploadDirectory();
  await Promise.all(
    uploads.map((upload) =>
      fs.unlink(path.join(directory, upload.storedName)).catch(() => {}),
    ),
  );

  return {
    workOrders: workOrderIds.length,
    documents: documentIds.length,
    users: userIds.length,
    customers: customerIds.length,
  };
}

async function main() {
  const removed = await removePreviousDemoRows();
  console.log(
    `→ Ryddet ${removed.workOrders} oppdrag, ${removed.documents} dokumenter, ` +
      `${removed.users} brukere og ${removed.customers} kunder.`,
  );

  const roles = await prisma.role.findMany({
    where: { key: { in: ["ADMIN", "OFFICE", "TECHNICIAN", "CUSTOMER"] } },
    select: { key: true },
  });
  if (roles.length < 4) {
    throw new Error(
      "Rolldata mangler (ADMIN/OFFICE/TECHNICIAN/CUSTOMER). Kjør migreringene først.",
    );
  }

  const department = await prisma.department.upsert({
    where: { name: DEMO.department },
    update: {
      description: "Standardavdeling for E2E-demoen.",
      isActive: true,
      isDefault: true,
      phone: "22 00 00 00",
      address: "Testveien 1",
      postalCode: "0150",
      city: "Oslo",
    },
    create: {
      name: DEMO.department,
      description: "Standardavdeling for E2E-demoen.",
      isActive: true,
      isDefault: true,
      phone: "22 00 00 00",
      address: "Testveien 1",
      postalCode: "0150",
      city: "Oslo",
    },
  });

  const passwordHashes = await Promise.all(
    Object.values(DEMO.users).map((user) => bcrypt.hash(user.password, 10)),
  );
  const [adminHash, officeHash, technicianHash, customerHash] = passwordHashes;

  const admin = await prisma.user.create({
    data: {
      email: DEMO.users.admin.email,
      name: DEMO.users.admin.name,
      password: adminHash,
      role: "ADMIN",
      departmentId: department.id,
      isActive: true,
    },
  });
  const office = await prisma.user.create({
    data: {
      email: DEMO.users.office.email,
      name: DEMO.users.office.name,
      password: officeHash,
      role: "OFFICE",
      departmentId: department.id,
      isActive: true,
    },
  });
  const technician = await prisma.user.create({
    data: {
      email: DEMO.users.technician.email,
      name: DEMO.users.technician.name,
      password: technicianHash,
      role: "TECHNICIAN",
      departmentId: department.id,
      isActive: true,
    },
  });

  const nordvik = await prisma.customer.create({
    data: {
      name: "Nordvik Testindustri AS",
      orgNumber: "999888777",
      address: "Testveien 1",
      postalCode: "0150",
      city: "Oslo",
      departmentId: department.id,
      responsibleTechnicianId: technician.id,
    },
  });
  const kari = await prisma.contact.create({
    data: {
      name: "Kari Nordvik",
      email: "kari.nordvik@example.test",
      phone: "22 00 00 01",
      customerId: nordvik.id,
    },
  });
  const fjordlys = await prisma.customer.create({
    data: {
      name: "Fjordlys Montasje AS",
      orgNumber: "999888778",
      address: "Fjordgata 22",
      postalCode: "5003",
      city: "Bergen",
      departmentId: department.id,
    },
  });
  const ola = await prisma.contact.create({
    data: {
      name: "Ola Fjord",
      email: "ola.fjord@example.test",
      phone: "55 00 00 02",
      customerId: fjordlys.id,
    },
  });

  const sorlandet = await prisma.customer.create({
    data: {
      name: "Sørlandet Demo Service AS",
      orgNumber: "999888779",
      address: "Sørveien 9",
      postalCode: "4610",
      city: "Kristiansand",
      departmentId: department.id,
    },
  });
  await prisma.contact.create({
    data: {
      name: "Mia Sør",
      email: "mia.sor@example.test",
      phone: "38 00 00 03",
      customerId: sorlandet.id,
    },
  });

  const customerUser = await prisma.user.create({
    data: {
      email: DEMO.users.customer.email,
      name: DEMO.users.customer.name,
      password: customerHash,
      role: "CUSTOMER",
      isActive: true,
      customerId: nordvik.id,
      contactId: kari.id,
    },
  });

  const pa400 = await prisma.product.create({
    data: {
      model: "Portautomatikk PA-400",
      serialNumber: "NV-4001",
      location: "Hovedinngang",
      customerId: nordvik.id,
    },
  });
  const tb90 = await prisma.product.create({
    data: {
      model: "Trykkbeholder TB-90",
      serialNumber: "NV-9002",
      location: "Kjeller",
      customerId: nordvik.id,
    },
  });
  const asd2 = await prisma.product.create({
    data: {
      model: "Automatisk skyvedør ASD-2",
      serialNumber: "FL-2001",
      location: "Resepsjon",
      customerId: fjordlys.id,
    },
  });
  const sp15 = await prisma.product.create({
    data: {
      model: "Sirkulasjonspumpe SP-15",
      serialNumber: "SD-1501",
      location: "Teknisk rom",
      customerId: sorlandet.id,
    },
  });

  const serviceTag = await prisma.tag.upsert({
    where: { name: "Service" },
    update: { color: "#2563eb" },
    create: { name: "Service", color: "#2563eb" },
  });
  const hmsTag = await prisma.tag.upsert({
    where: { name: "HMS" },
    update: { color: "#16a34a" },
    create: { name: "HMS", color: "#16a34a" },
  });
  const akuttTag = await prisma.tag.upsert({
    where: { name: "Akutt" },
    update: { color: "#dc2626" },
    create: { name: "Akutt", color: "#dc2626" },
  });

  const serviceTemplate = await prisma.template.create({
    data: {
      title: "Service av porter",
      description: "Standard sjekkliste for service av porter og portautomatikk.",
      category: "SERVICE",
      requiresUnits: true,
      fieldsJson: JSON.stringify(SERVICE_FIELDS),
    },
  });
  const hmsTemplate = await prisma.template.create({
    data: {
      title: "HMS – trykkbeholder",
      description: "Internkontroll og sikkerhetskontroll av trykkbeholder.",
      category: "HMS",
      hmsType: "INTERNAL_CONTROL",
      requiresUnits: true,
      fieldsJson: JSON.stringify(HMS_FIELDS),
    },
  });

  const createWorkOrder = (input) =>
    prisma.workOrder.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        scheduledFor: dateOnly(input.offsetDays),
        status: input.status,
        departmentId: department.id,
        customerId: input.customer?.id ?? null,
        productId: input.product?.id ?? null,
        contactId: input.contact?.id ?? null,
        creatorName: admin.name,
        technicians: input.technician
          ? { connect: { id: input.technician.id } }
          : undefined,
        templates: input.template ? { connect: { id: input.template.id } } : undefined,
        tags: input.tag ? { connect: { id: input.tag.id } } : undefined,
      },
    });

  const order1 = await createWorkOrder({
    title: "Service – automatiske dører",
    description: "Service av automatisk skyvedør i resepsjonen.",
    customer: fjordlys,
    product: asd2,
    offsetDays: 0,
    status: "PLANNED",
    technician,
    template: serviceTemplate,
    tag: serviceTag,
    contact: ola,
  });
  await createWorkOrder({
    title: "Årlig service – portautomatikk",
    description: "Årlig service er forfalt og oppdraget mangler montør.",
    customer: nordvik,
    product: pa400,
    offsetDays: -4,
    status: "PLANNED",
    tag: serviceTag,
  });
  const order3 = await createWorkOrder({
    title: "Feilsøking – portåpner",
    description: "Porten stopper halvveis. Feilsøking pågår.",
    customer: nordvik,
    product: pa400,
    offsetDays: 0,
    status: "IN_PROGRESS",
    technician,
    tag: akuttTag,
    contact: kari,
  });
  await createWorkOrder({
    title: "HMS-kontroll – trykkbeholder",
    description: "Internkontroll av trykkbeholder i kjelleren.",
    customer: nordvik,
    product: tb90,
    offsetDays: 0,
    status: "OPEN",
    technician,
    template: hmsTemplate,
    tag: hmsTag,
  });
  await createWorkOrder({
    title: "Kvartalsservice – pumpe",
    description: "Kvartalsvis service av sirkulasjonspumpe.",
    customer: sorlandet,
    product: sp15,
    offsetDays: 2,
    status: "PLANNED",
    technician,
    tag: serviceTag,
  });
  const order6 = await createWorkOrder({
    title: "Service – kjøleanlegg",
    description: "Service av kjøleanlegg med signert rapport.",
    customer: fjordlys,
    offsetDays: -7,
    status: "COMPLETED",
    technician,
    tag: serviceTag,
  });
  await createWorkOrder({
    title: "Venter på deler – portmotor",
    description: "Ny portmotor er bestilt og oppdraget venter på deler.",
    customer: nordvik,
    product: pa400,
    offsetDays: 5,
    status: "WAITING",
    technician,
    tag: serviceTag,
  });
  await createWorkOrder({
    title: "Avlyst service – dør",
    description: "Kunden avlyste avtalt service.",
    customer: sorlandet,
    offsetDays: -1,
    status: "CANCELLED",
    technician,
  });

  const report = await prisma.report.create({
    data: {
      workOrderId: order6.id,
      templateId: serviceTemplate.id,
      dataJson: JSON.stringify({ status: "GODKJENT", answers: {} }),
      name: "Service – kjøleanlegg",
      templateTitle: serviceTemplate.title,
      reportNumber: "DEMO-1001",
      requiresUnits: true,
      templateCategory: "SERVICE",
      templateSnapshotJson: serviceTemplate.fieldsJson,
      completedAt: dateTimeAtNoon(-7),
      isLocked: true,
      lockedAt: dateTimeAtNoon(-7),
      lockedByName: "Demo Montør",
      technicianName: "Demo Montør",
      customerName: "Ola Fjord",
    },
  });
  await prisma.reportUnit.create({
    data: {
      reportId: report.id,
      productId: asd2.id,
      label: "Automatisk skyvedør ASD-2",
      serialNumber: "FL-2001",
      location: "Resepsjon",
      status: "GODKJENT",
      answersJson: JSON.stringify({ Tilstand: "OK", Resultat: "OK" }),
      sortOrder: 0,
    },
  });

  await prisma.contract.create({
    data: {
      title: "Serviceavtale – porter",
      intervalMonths: 12,
      startDate: dateOnly(-300),
      nextServiceDate: dateOnly(10),
      isActive: true,
      customerId: nordvik.id,
      departmentId: department.id,
      contactId: kari.id,
      templateId: serviceTemplate.id,
    },
  });

  const [driftshandboker, sertifikater] = await Promise.all([
    prisma.documentFolder.create({ data: { name: "Driftshåndbøker" } }),
    prisma.documentFolder.create({ data: { name: "Sertifikater" } }),
  ]);
  const driftshandbokTag = await prisma.documentTag.upsert({
    where: { name: "Driftshåndbok" },
    update: {},
    create: { name: "Driftshåndbok", color: "#2563eb" },
  });
  const sertifikatTag = await prisma.documentTag.upsert({
    where: { name: "Sertifikat" },
    update: {},
    create: { name: "Sertifikat", color: "#16a34a" },
  });

  const documentSeeds = [
    {
      title: "Bruksanvisning – portautomatikk.pdf",
      description: "Bruksanvisning for portautomatikk PA-400.",
      folderId: driftshandboker.id,
      tagId: driftshandbokTag.id,
      text:
        "Bruksanvisning for portautomatikk PA-400. Kontroller nødstopp, sikkerhetsbryter og motor før service. " +
        "Åpne og lukk porten manuelt for å verifisere at ingen hindringer står i veien.",
    },
    {
      title: "HMS-sertifikat – trykkbeholder.pdf",
      description: "Sertifikat for trykkbeholder TB-90.",
      folderId: sertifikater.id,
      tagId: sertifikatTag.id,
      text:
        "HMS-sertifikat for trykkbeholder TB-90. Sertifikatet dokumenterer årlig kontroll av " +
        "sikkerhetsventil, trykk og korrosjonsbeskyttelse. Neste kontroll er om tolv måneder.",
    },
    {
      title: "Serviceavtale – Nordvik.pdf",
      description: "Signert serviceavtale for Nordvik Testindustri AS.",
      folderId: sertifikater.id,
      tagId: sertifikatTag.id,
      text:
        "Serviceavtale mellom Nordvik FSM Demo AS og Nordvik Testindustri AS. Avtalen omfatter " +
        "årlig service av porter og portautomatikk med tolv måneders intervall.",
    },
  ];

  const directory = uploadDirectory();
  await fs.mkdir(directory, { recursive: true });

  for (const seed of documentSeeds) {
    const storedName = `${randomUUID()}.pdf`;
    const filePath = path.join(directory, storedName);
    const pdf = buildPdf(`Demo dokument: ${seed.title}`);
    await fs.writeFile(filePath, pdf);

    const document = await prisma.document.create({
      data: {
        title: seed.title,
        description: seed.description,
        fileName: seed.title,
        filePath: `/uploads/${storedName}`,
        fileSize: pdf.length,
        mimeType: "application/pdf",
        contentText: seed.text,
        pageTexts: JSON.stringify([{ page: 1, text: seed.text }]),
        folderId: seed.folderId,
        uploadedBy: admin.name,
        tags: { connect: { id: seed.tagId } },
      },
    });
    await prisma.upload.create({
      data: {
        storedName,
        originalName: seed.title,
        mimeType: "application/pdf",
        size: pdf.length,
        ownerType: "DOCUMENT",
        ownerId: document.id,
        departmentId: department.id,
        uploadedById: admin.id,
      },
    });
  }

  await prisma.comment.createMany({
    data: [
      {
        workOrderId: order3.id,
        content: "Kunden melder at porten stopper halvveis.",
        authorName: "Demo Montør",
        createdAt: dateTimeAtNoon(-1),
      },
      {
        workOrderId: order3.id,
        content: "Ny motor bestilt.",
        authorName: "Demo Administrator",
        createdAt: dateTimeAtNoon(0),
      },
    ],
  });

  await prisma.notification.create({
    data: {
      userId: technician.id,
      type: "ASSIGNMENT",
      title: "Nytt oppdrag tildelt",
      body: "Service – automatiske dører hos Fjordlys Montasje AS.",
      sourceLabel: "Oppdrag: Service – automatiske dører",
      href: `/mine-oppdrag/${order1.id}`,
      dedupeKey: `${DEMO.notificationPrefix}assignment:${order1.id}`,
      emailSentAt: new Date(),
    },
  });
  await prisma.notification.create({
    data: {
      userId: admin.id,
      type: "REPORT_READY",
      title: "Rapport klar: Service – kjøleanlegg",
      body: "Montør har fullført og låst rapporten DEMO-1001.",
      sourceLabel: "Oppdrag: Service – kjøleanlegg",
      href: `/oppdrag/${order6.id}`,
      dedupeKey: `${DEMO.notificationPrefix}report-ready:${report.id}`,
      emailSentAt: new Date(),
    },
  });

  await prisma.auditLog.createMany({
    data: [
      {
        entityType: "WorkOrder",
        entityId: order1.id,
        action: "Kontoret opprettet nytt oppdrag: Service – automatiske dører",
        userName: admin.name,
        actorId: admin.id,
        createdAt: dateTimeAtNoon(-2),
      },
      {
        entityType: "WorkOrder",
        entityId: order1.id,
        action: "Kontoret endret status til: IN_PROGRESS",
        userName: technician.name,
        actorId: technician.id,
        metadata: { from: "PLANNED", to: "IN_PROGRESS" },
        createdAt: dateTimeAtNoon(0),
      },
      {
        entityType: "WorkOrder",
        entityId: order6.id,
        action: "Kontoret opprettet nytt oppdrag: Service – kjøleanlegg",
        userName: admin.name,
        actorId: admin.id,
        createdAt: dateTimeAtNoon(-8),
      },
      {
        entityType: "WorkOrder",
        entityId: order6.id,
        action: "Montør endret status til: COMPLETED",
        userName: technician.name,
        actorId: technician.id,
        metadata: { to: "COMPLETED" },
        createdAt: dateTimeAtNoon(-7),
      },
    ],
  });

  const existingBranding = await prisma.branding.findFirst();
  if (existingBranding) {
    await prisma.branding.update({
      where: { id: existingBranding.id },
      data: { companyName: "Nordvik FSM Demo AS", primaryColor: "#1d4ed8" },
    });
  } else {
    await prisma.branding.create({
      data: { companyName: "Nordvik FSM Demo AS", primaryColor: "#1d4ed8" },
    });
  }

  // Karttjenesten faller tilbake til standardverdier når raden mangler, så vi
  // oppretter den bare når den ikke finnes og lar eksisterende innstillinger stå.
  const existingMapSettings = await prisma.mapSettings.findUnique({
    where: { id: "default" },
  });
  if (!existingMapSettings) {
    await prisma.mapSettings.create({
      data: {
        id: "default",
        provider: "osm",
        defaultLayer: "osm",
        defaultZoom: 10,
        centerLat: 59.9139,
        centerLng: 10.7522,
      },
    });
  }

  const counts = {
    users: await prisma.user.count({
      where: { email: { in: Object.values(DEMO.users).map((user) => user.email) } },
    }),
    customers: await prisma.customer.count({
      where: { name: { in: DEMO.customerNames } },
    }),
    workOrders: await prisma.workOrder.count({
      where: { title: { in: DEMO.workOrderTitles } },
    }),
    reports: await prisma.report.count({
      where: { workOrderId: { in: [order6.id] } },
    }),
    documents: await prisma.document.count({
      where: { title: { in: DEMO.documentTitles } },
    }),
  };

  console.log("✔ E2E-demo skrevet:");
  console.log(`  avdeling: ${department.name}`);
  console.log(`  brukere: ${counts.users}`);
  console.log(`  kunder: ${counts.customers}`);
  console.log(`  oppdrag: ${counts.workOrders}`);
  console.log(`  rapporter: ${counts.reports}`);
  console.log(`  dokumenter: ${counts.documents}`);
  console.log(`  kontor: ${office.email}, kunde: ${customerUser.email}`);
  console.log(
    `  admin: ${admin.email}, montør: ${technician.email}`,
  );
}

main()
  .catch((error) => {
    console.error("✖ E2E-seed feilet:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
