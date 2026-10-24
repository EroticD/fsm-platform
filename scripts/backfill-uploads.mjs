#!/usr/bin/env node
/**
 * Backfill av Upload-metadata for filer som ble lastet opp før tilgangs-
 * kontrollen per fil ble innført.
 *
 * Kjør FØR /uploads begynner å avvise filer uten metadata:
 *   node scripts/backfill-uploads.mjs
 *
 * Skriptet er idempotent: filer som allerede har en Upload-rad hoppes over, slik
 * at manuelt korrigerte eiere ikke overskrives. Filer det ikke finnes noen
 * referanse til, listes til slutt. De er bare lesbare for administrator (se
 * src/app/uploads/[...path]/route.ts).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "node:fs/promises";
import path from "node:path";

// Prisma 7 krever en driver-adapter (samme oppsett som src/lib/prisma.ts).
const connectionString = process.env.DATABASE_URL ?? "";
const databaseUrl = new URL(connectionString);
const schema = databaseUrl.searchParams.get("schema") ?? undefined;
databaseUrl.searchParams.delete("schema");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl.toString() }, { schema }),
});
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(process.cwd(), "uploads");

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

function storedNameFromUrl(url) {
  if (typeof url !== "string" || !url.startsWith("/uploads/")) return null;
  const name = url.slice("/uploads/".length).split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null;
  return name;
}

/** Plukker ut alle /uploads/-referanser fra vilkårlig JSON. */
function collectUploadUrls(value, out = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("/uploads/")) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUploadUrls(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectUploadUrls(item, out);
  }
  return out;
}

async function fileInfo(storedName) {
  const ext = path.extname(storedName).toLowerCase();
  try {
    const stat = await fs.stat(path.join(uploadDir, storedName));
    return {
      originalName: storedName,
      mimeType: MIME_BY_EXT[ext] || "application/octet-stream",
      size: stat.size,
    };
  } catch {
    return {
      originalName: storedName,
      mimeType: MIME_BY_EXT[ext] || "application/octet-stream",
      size: 0,
    };
  }
}

async function ensureUpload(storedName, owner) {
  const existing = await prisma.upload.findUnique({ where: { storedName } });
  if (existing) return false;

  const info = await fileInfo(storedName);
  await prisma.upload.create({
    data: {
      storedName,
      ...info,
      ownerType: owner.ownerType,
      ownerId: owner.ownerId ?? null,
      departmentId: owner.departmentId ?? null,
      customerId: owner.customerId ?? null,
      uploadedById: owner.uploadedById ?? null,
    },
  });
  return true;
}

async function main() {
  let created = 0;

  const attachments = await prisma.attachment.findMany({
    include: {
      workOrder: { select: { id: true, departmentId: true, customerId: true } },
    },
  });
  for (const attachment of attachments) {
    const storedName = storedNameFromUrl(attachment.dataUrl);
    if (!storedName) continue;
    if (
      await ensureUpload(storedName, {
        ownerType: "WORK_ORDER",
        ownerId: attachment.workOrderId,
        departmentId: attachment.workOrder.departmentId,
        customerId: attachment.workOrder.customerId,
      })
    ) {
      created++;
    }
  }

  const customerAttachments = await prisma.customerAttachment.findMany({
    include: { customer: { select: { id: true, departmentId: true } } },
  });
  for (const attachment of customerAttachments) {
    const storedName = storedNameFromUrl(attachment.dataUrl);
    if (!storedName) continue;
    if (
      await ensureUpload(storedName, {
        ownerType: "CUSTOMER",
        ownerId: attachment.customerId,
        departmentId: attachment.customer.departmentId,
        customerId: attachment.customerId,
      })
    ) {
      created++;
    }
  }

  const documents = await prisma.document.findMany({
    select: { id: true, filePath: true },
  });
  for (const document of documents) {
    const storedName = storedNameFromUrl(document.filePath);
    if (!storedName) continue;
    if (
      await ensureUpload(storedName, {
        ownerType: "DOCUMENT",
        ownerId: document.id,
        departmentId: null,
        customerId: null,
      })
    ) {
      created++;
    }
  }

  const versions = await prisma.documentVersion.findMany({
    select: { documentId: true, filePath: true },
  });
  for (const version of versions) {
    const storedName = storedNameFromUrl(version.filePath);
    if (!storedName) continue;
    if (
      await ensureUpload(storedName, {
        ownerType: "DOCUMENT",
        ownerId: version.documentId,
        departmentId: null,
        customerId: null,
      })
    ) {
      created++;
    }
  }

  const units = await prisma.reportUnit.findMany({
    include: {
      report: {
        include: {
          workOrder: { select: { id: true, departmentId: true, customerId: true } },
        },
      },
    },
  });
  for (const unit of units) {
    let answers;
    try {
      answers = JSON.parse(unit.answersJson);
    } catch {
      continue;
    }
    for (const url of collectUploadUrls(answers)) {
      const storedName = storedNameFromUrl(url);
      if (!storedName) continue;
      if (
        await ensureUpload(storedName, {
          ownerType: "WORK_ORDER",
          ownerId: unit.report.workOrderId,
          departmentId: unit.report.workOrder.departmentId,
          customerId: unit.report.workOrder.customerId,
        })
      ) {
        created++;
      }
    }
  }

  // Eldre rapporter kan ha bilder i dataJson i stedet for i enhetene.
  const reports = await prisma.report.findMany({
    include: {
      workOrder: { select: { id: true, departmentId: true, customerId: true } },
    },
  });
  for (const report of reports) {
    let data;
    try {
      data = JSON.parse(report.dataJson);
    } catch {
      continue;
    }
    for (const url of collectUploadUrls(data)) {
      const storedName = storedNameFromUrl(url);
      if (!storedName) continue;
      if (
        await ensureUpload(storedName, {
          ownerType: "WORK_ORDER",
          ownerId: report.workOrderId,
          departmentId: report.workOrder.departmentId,
          customerId: report.workOrder.customerId,
        })
      ) {
        created++;
      }
    }
  }

  // Filer på disk uten referanse: list dem, slik at de kan vurderes manuelt.
  let onDisk = [];
  try {
    onDisk = await fs.readdir(uploadDir);
  } catch {
    console.warn(`Fant ikke opplastingsmappen: ${uploadDir}`);
  }
  const registered = new Set(
    (await prisma.upload.findMany({ select: { storedName: true } })).map(
      (row) => row.storedName,
    ),
  );
  const unknown = onDisk.filter(
    (name) => !registered.has(name) && !name.startsWith("."),
  );

  console.log(`Opprettet ${created} Upload-rader.`);
  if (unknown.length > 0) {
    console.log(`\n${unknown.length} fil(er) uten referanse (bare administrator kan lese):`);
    for (const name of unknown) console.log(`  - ${name}`);
  } else {
    console.log("Alle filer på disk har metadata.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
