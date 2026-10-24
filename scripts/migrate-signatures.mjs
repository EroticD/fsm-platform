#!/usr/bin/env node
/**
 * Flytter signaturer som ligger som data-URL-er i Report-radene over til
 * vanlige filer i opplastingsmappen, med en Upload-rad per fil.
 *
 *   node scripts/migrate-signatures.mjs
 *
 * Skriptet er idempotent: det plukker bare rapporter der én av signaturkolonnene
 * fortsatt starter med «data:». Rapporter som allerede peker på /uploads
 * hoppes over.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
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

const MAX_SIGNATURE_BYTES = 5 * 1024 * 1024;
const DATA_IMAGE = /^data:image\/(png|jpe?g|webp);base64,([a-z\d+/=\s]+)$/i;
const EXT_BY_SUBTYPE = { png: ".png", jpg: ".jpg", jpeg: ".jpg", webp: ".webp" };

function decodeDataImage(value) {
  if (typeof value !== "string") return null;
  const match = DATA_IMAGE.exec(value.trim());
  if (!match) return null;

  const subtype = match[1].toLowerCase();
  const extension = EXT_BY_SUBTYPE[subtype];
  if (!extension) return null;

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > MAX_SIGNATURE_BYTES) return null;

  return {
    buffer,
    extension,
    mimeType: subtype === "jpg" || subtype === "jpeg" ? "image/jpeg" : `image/${subtype}`,
  };
}

async function storeSignature(value, workOrder) {
  const decoded = decodeDataImage(value);
  if (!decoded) return null;

  const storedName = `${randomUUID()}${decoded.extension}`;
  const filePath = path.join(uploadDir, storedName);
  await fs.writeFile(filePath, decoded.buffer);

  try {
    await prisma.upload.create({
      data: {
        storedName,
        originalName: `signatur${decoded.extension}`,
        mimeType: decoded.mimeType,
        size: decoded.buffer.length,
        ownerType: "WORK_ORDER",
        ownerId: workOrder.id,
        departmentId: workOrder.departmentId,
        customerId: workOrder.customerId,
        uploadedById: null,
      },
    });
  } catch (error) {
    await fs.unlink(filePath).catch(() => undefined);
    throw error;
  }

  return `/uploads/${storedName}`;
}

async function main() {
  await fs.mkdir(uploadDir, { recursive: true });

  const reports = await prisma.report.findMany({
    where: {
      OR: [
        { technicianSignatureUrl: { startsWith: "data:" } },
        { customerSignatureUrl: { startsWith: "data:" } },
      ],
    },
    select: {
      id: true,
      technicianSignatureUrl: true,
      customerSignatureUrl: true,
      workOrder: { select: { id: true, departmentId: true, customerId: true } },
    },
  });

  let migrated = 0;
  let reportsChanged = 0;
  let skipped = 0;

  for (const report of reports) {
    const update = {};

    for (const [column, value] of [
      ["technicianSignatureUrl", report.technicianSignatureUrl],
      ["customerSignatureUrl", report.customerSignatureUrl],
    ]) {
      if (typeof value !== "string" || !value.startsWith("data:")) continue;

      const fileUrl = await storeSignature(value, report.workOrder);
      if (!fileUrl) {
        skipped++;
        console.warn(`  ! Ugyldig ${column} på rapport ${report.id} – hoppet over`);
        continue;
      }
      update[column] = fileUrl;
      migrated++;
    }

    if (Object.keys(update).length > 0) {
      await prisma.report.update({ where: { id: report.id }, data: update });
      reportsChanged++;
    }
  }

  console.log(
    `Migrerte ${migrated} signatur(er) i ${reportsChanged} rapport(er).` +
      (skipped > 0 ? ` Hoppet over ${skipped} ugyldig(e).` : ""),
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
