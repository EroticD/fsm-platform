import path from "path";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { releaseUpload } from "@/lib/upload-cleanup";
import {
  documentCreateSchema,
  documentFolderCreateSchema,
  documentIdSchema,
  documentUpdateSchema,
  documentVersionSchema,
} from "@/lib/schemas/document";
import { LIMITS, cleanText, cleanUrl } from "@/lib/sanitize";
import { linkUploadOwner } from "@/lib/upload-access";
import { enqueuePdfText } from "@/lib/pdf-queue";
import {
  can,
  fail,
  isAdminActor,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

/** Dokumentlisten pagineres; versjoner hentes bare for detaljvisningen. */
export const DOCUMENT_PAGE_SIZE = 30;

/**
 * Bare filer som ligger i opplastingsmappen kan lagres som dokument.
 * Samme mønster som opplastingsruten bruker; det hindrer at en dokumentrad
 * peker på en vilkårlig URL eller en lokal fil utenfor uploads.
 */
const UPLOAD_URL = /^\/uploads\/[A-Za-z0-9._-]+$/;

function isUploadUrl(value: string): boolean {
  return UPLOAD_URL.test(value);
}

export type DocumentLibraryParams = {
  folderId: string | null;
  search: string;
  tag: string;
  page: number;
  documentId: string | null;
};

/** Alt dokumentbiblioteket trenger for én sidevisning. */
export async function getDocumentLibrary(
  actor: ServiceActor,
  params: DocumentLibraryParams,
) {
  if (!can(actor, "documents.view")) return fail("forbidden");

  const folderId = params.folderId;
  const searchQuery = params.search.trim();
  const tagFilter = params.tag;
  const page = Math.max(1, params.page);

  let currentFolder: {
    id: string;
    name: string;
    parentId: string | null;
  } | null = null;
  const breadcrumb: { id: string; name: string; parentId: string | null }[] = [];
  if (folderId) {
    currentFolder = await prisma.documentFolder.findUnique({
      where: { id: folderId },
    });
    let current = currentFolder;
    while (current) {
      breadcrumb.unshift(current);
      if (current.parentId) {
        current = await prisma.documentFolder.findUnique({
          where: { id: current.parentId },
        });
      } else {
        current = null;
      }
    }
  }

  const [subFolders, allFolders] = await Promise.all([
    prisma.documentFolder.findMany({
      where: { parentId: folderId },
      orderBy: { name: "asc" },
      take: 200,
    }),
    prisma.documentFolder.findMany({
      orderBy: { name: "asc" },
      take: 200,
    }),
  ]);

  const docWhere: Prisma.DocumentWhereInput = { folderId };
  if (searchQuery) {
    docWhere.OR = [
      { title: { contains: searchQuery, mode: "insensitive" } },
      { description: { contains: searchQuery, mode: "insensitive" } },
      { fileName: { contains: searchQuery, mode: "insensitive" } },
      {
        tags: {
          some: { name: { contains: searchQuery, mode: "insensitive" } },
        },
      },
    ];
  }
  if (tagFilter) {
    docWhere.tags = { some: { name: tagFilter } };
  }

  const [documents, totalDocuments, detailDocument, existingFiles] =
    await Promise.all([
      prisma.document.findMany({
        where: docWhere,
        select: {
          id: true,
          title: true,
          description: true,
          fileName: true,
          filePath: true,
          fileSize: true,
          mimeType: true,
          folderId: true,
          uploadedBy: true,
          tags: { select: { id: true, name: true, color: true } },
        },
        orderBy: { title: "asc" },
        take: DOCUMENT_PAGE_SIZE,
        skip: (page - 1) * DOCUMENT_PAGE_SIZE,
      }),
      prisma.document.count({ where: docWhere }),
      params.documentId
        ? prisma.document.findUnique({
            where: { id: params.documentId },
            select: {
              id: true,
              title: true,
              description: true,
              fileName: true,
              filePath: true,
              fileSize: true,
              mimeType: true,
              folderId: true,
              uploadedBy: true,
              tags: { select: { id: true, name: true, color: true } },
              // Versjoner lastes bare når dokumentet faktisk åpnes i detalj.
              versions: {
                orderBy: { createdAt: "desc" },
                take: 50,
                select: {
                  id: true,
                  fileName: true,
                  filePath: true,
                  fileSize: true,
                  createdAt: true,
                  createdBy: true,
                },
              },
            },
          })
        : Promise.resolve(null),
      // Duplikatkontroll ved mappeopplasting trenger filnavn og størrelse for
      // hele mappen – men bare disse lette feltene, ikke dokumentinnholdet.
      prisma.document.findMany({
        where: { folderId },
        select: { fileName: true, fileSize: true },
        take: 1000,
      }),
    ]);

  // Sørg for at mappen som vises (og detaljens mappe) alltid finnes i
  // nedtrekkslisten, ellers kan et lagre uten endringer flytte dokumentet.
  const visibleFolderIds = [folderId, detailDocument?.folderId].filter(
    (id): id is string => Boolean(id),
  );
  const folderOptions = [...allFolders];
  if (visibleFolderIds.length > 0) {
    const extraFolders = await prisma.documentFolder.findMany({
      where: { id: { in: visibleFolderIds } },
      take: 10,
    });
    for (const folder of extraFolders) {
      if (!folderOptions.some((option) => option.id === folder.id)) {
        folderOptions.unshift(folder);
      }
    }
  }

  const allTags = await prisma.documentTag.findMany({
    orderBy: { name: "asc" },
  });

  return ok({
    currentFolder,
    breadcrumb,
    subFolders,
    allFolders,
    documents,
    totalDocuments,
    totalPages: Math.max(1, Math.ceil(totalDocuments / DOCUMENT_PAGE_SIZE)),
    detailDocument,
    existingFiles,
    folderOptions,
    allTags,
  });
}

export type DocumentLibraryResult = Awaited<
  ReturnType<typeof getDocumentLibrary>
>;
export type DocumentLibraryData = Extract<
  DocumentLibraryResult,
  { ok: true }
>["data"];

export async function createFolder(
  actor: ServiceActor,
  input: { name?: unknown; parentId: string | null },
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "documents.manage")) return fail("forbidden");

  const parsed = documentFolderCreateSchema.safeParse({
    name: cleanText(input.name, { maxLength: LIMITS.title }),
  });
  if (!parsed.success) return fail("invalid");
  const name = parsed.data.name;

  const created = await prisma.$transaction(async (tx) => {
    const folder = await tx.documentFolder.create({
      data: { name, parentId: input.parentId },
    });
    await audit(tx, {
      entityType: "DocumentFolder",
      entityId: folder.id,
      action: `Opprettet mappe: ${name}`,
      actor: toAuditActor(actor),
    });
    return folder;
  });

  return ok({ id: created.id });
}

export async function deleteFolder(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const parsed = documentIdSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const id = parsed.data.id;

  const folder = await prisma.documentFolder.findUnique({ where: { id } });
  if (!folder) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.documentFolder.delete({ where: { id } });
    await audit(tx, {
      entityType: "DocumentFolder",
      entityId: id,
      action: `Slettet mappe: ${folder.name}`,
      actor: toAuditActor(actor),
    });
  });

  return ok(undefined);
}

/** Arkiverer gjeldende fil og ruller dokumentet tilbake til valgt versjon. */
export async function restoreDocumentVersion(
  actor: ServiceActor,
  input: { versionId?: unknown },
): Promise<ServiceResult> {
  if (!actor.isActive || !can(actor, "documents.manage")) {
    return fail("forbidden");
  }

  const parsed = documentVersionSchema.safeParse({
    versionId: cleanText(input.versionId, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const versionId = parsed.data.versionId;

  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
  });
  if (!version) return fail("not_found");

  const doc = await prisma.document.findUnique({
    where: { id: version.documentId },
  });
  if (!doc) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    // Arkiver nåværende fil før vi ruller tilbake.
    await tx.documentVersion.create({
      data: {
        documentId: doc.id,
        fileName: doc.fileName,
        filePath: doc.filePath,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        createdBy: actor.name || "Kontor",
      },
    });

    await tx.document.update({
      where: { id: doc.id },
      data: {
        fileName: version.fileName,
        filePath: version.filePath,
        fileSize: version.fileSize,
        mimeType: version.mimeType,
      },
    });

    await audit(tx, {
      entityType: "Document",
      entityId: doc.id,
      action: `Gjenopprettet tidligere versjon av dokument: ${doc.title}`,
      actor: toAuditActor(actor),
    });
  });

  return ok(undefined);
}

export async function deleteDocument(
  actor: ServiceActor,
  input: { id?: unknown },
): Promise<ServiceResult> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const parsed = documentIdSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const id = parsed.data.id;

  const doc = await prisma.document.findUnique({
    where: { id },
    include: { versions: { select: { filePath: true } } },
  });
  if (!doc) return fail("not_found");

  const fileUrls = [doc.filePath, ...doc.versions.map((version) => version.filePath)];

  await prisma.$transaction(async (tx) => {
    await tx.document.delete({ where: { id } });
    await audit(tx, {
      entityType: "Document",
      entityId: id,
      action: `Slettet dokument: ${doc.title}`,
      actor: toAuditActor(actor),
    });
  });

  // Frigjør filene etter at dokumentet og versjonene er borte. Filer som
  // fortsatt er referert fra en annen rad blir liggende.
  for (const fileUrl of new Set(fileUrls)) {
    await releaseUpload(fileUrl);
  }

  return ok(undefined);
}

export type DocumentUpdateInput = {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  folderId?: unknown;
  fileUrl?: unknown;
  fileName?: unknown;
  fileSize?: unknown;
  tagNames?: unknown[];
};

/** Oppdaterer mappe, tags, tittel og eventuelt filen. */
export async function updateDocument(
  actor: ServiceActor,
  input: DocumentUpdateInput,
): Promise<ServiceResult> {
  if (!can(actor, "documents.manage")) return fail("forbidden");

  const parsed = documentUpdateSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
    title: cleanText(input.title, { maxLength: LIMITS.title }),
    description: cleanText(input.description, { maxLength: LIMITS.text }),
    folderId: cleanText(input.folderId, { maxLength: LIMITS.line }),
    fileUrl: cleanUrl(input.fileUrl),
    fileName: cleanText(input.fileName, { maxLength: LIMITS.line }),
    fileSize:
      parseInt(
        cleanText(input.fileSize, { maxLength: LIMITS.line }) || "0",
        10,
      ) || 0,
    tagNames: (input.tagNames ?? [])
      .map((tag) => cleanText(tag, { maxLength: LIMITS.short }))
      .filter(Boolean),
  });
  if (!parsed.success) return fail("invalid");
  const {
    id,
    title,
    description,
    folderId,
    fileUrl,
    fileName,
    fileSize,
    tagNames,
  } = parsed.data;

  if (fileUrl && !isUploadUrl(fileUrl)) return fail("invalid");

  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) return fail("not_found");

  // Behold den gamle filen som en versjon før den byttes ut.
  const replacingFile = Boolean(fileUrl && fileUrl !== existing.filePath);

  await prisma.$transaction(async (tx) => {
    if (replacingFile) {
      await tx.documentVersion.create({
        data: {
          documentId: id,
          fileName: existing.fileName,
          filePath: existing.filePath,
          fileSize: existing.fileSize,
          mimeType: existing.mimeType,
          createdBy: actor.name || "Kontor",
        },
      });
    }

    await tx.document.update({
      where: { id },
      data: {
        title,
        description: description || null,
        folderId: folderId ?? null,
        tags: {
          set: [],
          connectOrCreate: tagNames.map((name) => ({
            where: { name },
            create: { name },
          })),
        },
        // Filen kan byttes ut – da oppdateres sti/størrelse
        ...(fileUrl ? { filePath: fileUrl } : {}),
        ...(fileName ? { fileName } : {}),
        ...(fileSize ? { fileSize } : {}),
      },
    });

    await audit(tx, {
      entityType: "Document",
      entityId: id,
      action: `Oppdaterte dokument: ${title}`,
      actor: toAuditActor(actor),
    });
  });

  // Hvis filen ble byttet, trekk ut ny tekst i bakgrunnen.
  if (replacingFile) {
    await linkUploadOwner(fileUrl, {
      ownerType: "DOCUMENT",
      ownerId: id,
      departmentId: actor.departmentId,
      customerId: null,
    });
    enqueuePdfText(id, fileUrl);
  }

  return ok(undefined);
}

export type DocumentCreateInput = {
  title?: unknown;
  description?: unknown;
  fileUrl?: unknown;
  fileName?: unknown;
  fileSize?: unknown;
  folderId?: unknown;
  tagNames?: unknown[];
};

export async function createDocument(
  actor: ServiceActor,
  input: DocumentCreateInput,
): Promise<ServiceResult<{ id: string }>> {
  if (!can(actor, "documents.manage")) return fail("forbidden");

  const parsed = documentCreateSchema.safeParse({
    title: cleanText(input.title, { maxLength: LIMITS.title }),
    description: cleanText(input.description, { maxLength: LIMITS.text }),
    fileUrl: cleanUrl(input.fileUrl),
    fileName: cleanText(input.fileName, { maxLength: LIMITS.line }),
    fileSize:
      parseInt(
        cleanText(input.fileSize, { maxLength: LIMITS.line }) || "0",
        10,
      ) || 0,
    folderId: cleanText(input.folderId, { maxLength: LIMITS.line }),
    tagNames: (input.tagNames ?? [])
      .map((tag) => cleanText(tag, { maxLength: LIMITS.short }))
      .filter(Boolean),
  });
  if (!parsed.success) return fail("invalid");
  const {
    title,
    description,
    fileUrl,
    fileName,
    fileSize,
    folderId: targetFolderId,
    tagNames,
  } = parsed.data;

  if (!isUploadUrl(fileUrl)) return fail("invalid");

  const newDoc = await prisma.$transaction(async (tx) => {
    const created = await tx.document.create({
      data: {
        title,
        description: description || null,
        fileName: fileName || "dokument.pdf",
        filePath: fileUrl,
        fileSize,
        mimeType: "application/pdf",
        folderId: targetFolderId ?? null,
        tags: {
          connectOrCreate: tagNames.map((name) => ({
            where: { name },
            create: { name },
          })),
        },
        uploadedBy: actor.name || "Kontor",
      },
    });

    await audit(tx, {
      entityType: "Document",
      entityId: created.id,
      action: `Lastet opp dokument: ${title}`,
      actor: toAuditActor(actor),
    });

    return created;
  });

  await linkUploadOwner(fileUrl, {
    ownerType: "DOCUMENT",
    ownerId: newDoc.id,
    departmentId: actor.departmentId,
    customerId: null,
  });

  // Ekstraher PDF-tekst for fulltekst-søk i bakgrunnen (best-effort)
  enqueuePdfText(newDoc.id, fileUrl);

  return ok({ id: newDoc.id });
}

type BulkItem = {
  title?: string;
  fileUrl: string;
  fileName?: string;
  fileSize: number;
  relativePath: string;
};

/**
 * Bulk-opplasting kommer som JSON fra klienten. Det finnes ingen delt
 * zod-schema for elementene, så feltene valideres og normaliseres her.
 */
function parseBulkItems(raw: string): BulkItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const items: BulkItem[] = [];
  for (const value of parsed) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    const fileUrl =
      typeof record.fileUrl === "string" ? record.fileUrl : "";
    if (!fileUrl) continue;
    items.push({
      title: typeof record.title === "string" ? record.title : undefined,
      fileUrl,
      fileName:
        typeof record.fileName === "string" ? record.fileName : undefined,
      fileSize:
        typeof record.fileSize === "number" &&
        Number.isFinite(record.fileSize)
          ? record.fileSize
          : 0,
      relativePath:
        typeof record.relativePath === "string" ? record.relativePath : "",
    });
  }
  return items.length > 0 ? items : null;
}

export async function bulkCreateDocuments(
  actor: ServiceActor,
  input: { itemsJson?: unknown; folderId: string | null },
): Promise<ServiceResult<{ created: number; skipped: number }>> {
  if (!can(actor, "documents.manage")) return fail("forbidden");

  const itemsJson = cleanText(input.itemsJson, { maxLength: 100000 });
  if (!itemsJson) return fail("invalid");
  const items = parseBulkItems(itemsJson);
  if (!items) return fail("invalid");
  if (items.some((item) => !isUploadUrl(item.fileUrl))) return fail("invalid");

  // Mappe: relativ sti -> DocumentFolder id
  const folderMap = new Map<string, string | null>();
  folderMap.set("", input.folderId);

  // Samle alle unike mapper
  const dirs = new Set<string>();
  for (const item of items) {
    const dirRel = path.dirname(item.relativePath || "");
    if (dirRel && dirRel !== ".") {
      // Legg til alle foreldre-mapper
      const parts = dirRel.split(/[/\\]/).filter(Boolean);
      let acc = "";
      for (const part of parts) {
        acc = acc ? acc + "/" + part : part;
        dirs.add(acc);
      }
    }
  }

  // Opprett mapper (sorter slik at foreldre kommer først)
  const sortedDirs = Array.from(dirs).sort(
    (a, b) => a.split("/").length - b.split("/").length,
  );
  for (const dirRel of sortedDirs) {
    const parts = dirRel.split("/");
    const name = parts[parts.length - 1];
    const parentRel = parts.slice(0, -1).join("/");
    const parentKey = parentRel || "";
    const parentId = folderMap.get(parentKey) ?? input.folderId;
    // Sjekk om mappen allerede finnes
    const existing = await prisma.documentFolder.findFirst({
      where: { name, parentId: parentId || null },
    });
    if (existing) {
      folderMap.set(dirRel, existing.id);
    } else {
      const created = await prisma.documentFolder.create({
        data: { name, parentId: parentId || null },
      });
      folderMap.set(dirRel, created.id);
    }
  }

  // Opprett dokumenter
  let count = 0;
  let skippedServer = 0;
  for (const item of items) {
    const dirRel = path.dirname(item.relativePath || "");
    const dirKey = dirRel === "." ? "" : dirRel.replace(/\\/g, "/");
    const targetFolderId = folderMap.get(dirKey) ?? input.folderId;

    // Hopp over hvis filen allerede eksisterer med samme navn og størrelse
    const existing = await prisma.document.findFirst({
      where: {
        fileName: item.fileName || "dokument.pdf",
        fileSize: item.fileSize || 0,
        folderId: targetFolderId || null,
      },
    });
    if (existing) {
      skippedServer++;
      continue;
    }

    const documentTitle =
      item.title ||
      path.basename(
        item.fileName || "dokument",
        path.extname(item.fileName || ".pdf"),
      );

    const newDoc = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          title: documentTitle,
          fileName: item.fileName || "dokument.pdf",
          filePath: item.fileUrl,
          fileSize: item.fileSize || 0,
          mimeType: "application/pdf",
          folderId: targetFolderId || null,
          uploadedBy: actor.name || "Kontor",
        },
      });

      await audit(tx, {
        entityType: "Document",
        entityId: created.id,
        action: `Lastet opp dokument: ${documentTitle}`,
        actor: toAuditActor(actor),
      });

      return created;
    });

    await linkUploadOwner(item.fileUrl, {
      ownerType: "DOCUMENT",
      ownerId: newDoc.id,
      departmentId: actor.departmentId,
      customerId: null,
    });

    // Ekstraher PDF-tekst (best-effort, legges i bakgrunnskø)
    enqueuePdfText(newDoc.id, item.fileUrl);

    count++;
  }

  if (count > 0 || skippedServer > 0) {
    console.info(
      `Bulk-opplasting av dokumenter: ${count} nye filer` +
        (skippedServer > 0 ? `, ${skippedServer} hoppet over` : ""),
    );
  }

  return ok({ created: count, skipped: skippedServer });
}

/** Sender manglende PDF-er til fulltekst-indeksering på nytt. */
export async function reindexDocuments(
  actor: ServiceActor,
): Promise<ServiceResult<{ queued: number }>> {
  if (!can(actor, "documents.manage")) return fail("forbidden");

  const docs = await prisma.document.findMany({
    where: { OR: [{ contentText: null }, { contentText: "" }] },
    select: { id: true, filePath: true },
    take: 500,
  });
  for (const doc of docs) {
    enqueuePdfText(doc.id, doc.filePath);
  }
  if (docs.length > 0) {
    // Én logg per dokument, slik at hver rad har sin egen, ekte id.
    await prisma.$transaction(async (tx) => {
      for (const doc of docs) {
        await audit(tx, {
          entityType: "Document",
          entityId: doc.id,
          action: "Reindekserte dokumentet for fulltekst-søk",
          actor: toAuditActor(actor),
        });
      }
    });
  }

  return ok({ queued: docs.length });
}
