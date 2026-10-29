import fs from "node:fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  documentCreateSchema,
  documentFolderCreateSchema,
  documentIdSchema,
  documentUpdateSchema,
  documentVersionSchema,
} from "@/lib/schemas/document";
import { LIMITS, cleanText, cleanUrl } from "@/lib/sanitize";
import { claimUpload } from "@/lib/upload-access";
import { enqueuePdfText } from "@/lib/pdf-queue";
import { findDocumentIdsBySearch } from "@/lib/document-search";
import { uploadDir } from "@/lib/uploads";
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

/** Sikkerhetsgrenser for massehandlinger, slik at én forespørsel er avgrenset. */
const MAX_BULK_ITEMS = 1000;
const MAX_BULK_SELECTION = 100;
const MAX_FOLDER_DEPTH = 50;

export type DocumentLibraryParams = {
  folderId: string | null;
  search: string;
  tag: string;
  page: number;
  documentId: string | null;
  /** Administrator kan vise papirkurven. Vanlige brukere ser den aldri. */
  deleted?: boolean;
  /**
   * Når dette er satt, begrenses både tekstsøk og tag-filter til mappen.
   *
   * Uten søk/filter viser roten hele biblioteket. `onlyFolder` på rot betyr
   * derfor «bare løse filer i roten». Inne i en mappe er mappen fortsatt
   * rammen for blaing, uavhengig av flagget.
   */
  onlyFolder?: boolean;
  /**
   * Når dette er satt, skal hele biblioteket vises selv om en mappe er valgt.
   * Brukes av det synlige søkeomfanget («Hele biblioteket»).
   */
  libraryScope?: boolean;
};

type FolderRow = { id: string; name: string; parentId: string | null };

/**
 * Bygger visningsstier for dokumentene på siden. Antall mapper er avgrenset av
 * sidestørrelsen, og hvert nivå hentes med `take` slik at spørringen aldri blir
 * ubegrenset.
 */
async function folderPathMap(
  folderIds: (string | null)[],
): Promise<Map<string, string>> {
  const byId = new Map<string, FolderRow>();
  let pending = [
    ...new Set(folderIds.filter((id): id is string => Boolean(id))),
  ];

  for (let depth = 0; depth < MAX_FOLDER_DEPTH && pending.length > 0; depth++) {
    const rows = await prisma.documentFolder.findMany({
      where: { id: { in: pending } },
      select: { id: true, name: true, parentId: true },
      take: 200,
    });
    const next = new Set<string>();
    for (const row of rows) {
      if (byId.has(row.id)) continue;
      byId.set(row.id, row);
      if (row.parentId) next.add(row.parentId);
    }
    pending = [...next];
  }

  const paths = new Map<string, string>();
  for (const id of byId.keys()) {
    const names: string[] = [];
    let current: FolderRow | undefined = byId.get(id);
    let guard = 0;
    while (current && guard < MAX_FOLDER_DEPTH) {
      names.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
      guard++;
    }
    paths.set(id, names.join(" / "));
  }
  return paths;
}

/**
 * Fjerner en opplasting som fortsatt ikke er knyttet til et dokument. Brukes
 * når en import hopper over en duplikatfil, slik at disken ikke fylles av
 * filer ingen dokumentrad peker på.
 */
async function removeOrphanedUpload(
  actorId: string,
  fileUrl: string,
): Promise<boolean> {
  if (!isUploadUrl(fileUrl)) return false;
  const storedName = fileUrl.slice("/uploads/".length);
  const removed = await prisma.upload.deleteMany({
    where: {
      storedName,
      ownerType: "DOCUMENT",
      ownerId: null,
      uploadedById: actorId,
    },
  });
  if (removed.count === 0) return false;
  try {
    await fs.unlink(path.join(uploadDir(), storedName));
  } catch {
    // Filen kan allerede være borte, eller ligge på et annet volum.
  }
  return true;
}

/** Leser en liste med dokument-ID-er fra en server action på en avgrenset måte. */
function parseBulkIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids: string[] = [];
  for (const value of raw) {
    const id = cleanText(value, { maxLength: LIMITS.line });
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0 || ids.length > MAX_BULK_SELECTION) return null;
  return ids;
}

/** Per-dokument-resultat fra en massehandling. */
export type DocumentBulkItemOutcome = {
  id: string;
  title: string;
  status: "ok" | "failed";
  reason?: string;
};

export type DocumentBulkMutationResult = {
  succeeded: number;
  failed: number;
  results: DocumentBulkItemOutcome[];
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
  // Papirkurven er forbeholdt administrator, uavhengig av hva URL-en ber om.
  const showDeleted = Boolean(params.deleted) && isAdminActor(actor);
  const deletedFilter = showDeleted ? { not: null } : null;

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
    let depth = 0;
    while (current && depth < MAX_FOLDER_DEPTH) {
      breadcrumb.unshift(current);
      if (current.parentId) {
        current = await prisma.documentFolder.findUnique({
          where: { id: current.parentId },
        });
      } else {
        current = null;
      }
      depth++;
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

  const filtering = Boolean(searchQuery || tagFilter);
  // Uten søk/filter er roten hele biblioteket, mens en valgt mappe fortsatt er
  // rammen for blaing. Med søk/filter styrer «Denne mappen»/«Hele biblioteket»
  // om søket begrenses til mappen.
  const useFolderScope = params.libraryScope
    ? false
    : filtering
      ? Boolean(params.onlyFolder)
      : Boolean(folderId) || Boolean(params.onlyFolder);
  const docWhere: Prisma.DocumentWhereInput = {
    ...(useFolderScope ? { folderId } : {}),
    deletedAt: deletedFilter,
  };
  if (searchQuery) {
    // Normalisert søk i tittel, beskrivelse, filnavn og tags. Søket gjøres i
    // databasen og returnerer bare ID-er, slik at store tekstfelt aldri lastes
    // inn i Node. Sletting, tag-filter og paginering avgjøres fortsatt av
    // Prisma-spørringene nedenfor.
    docWhere.id = { in: await findDocumentIdsBySearch(searchQuery) };
  }
  if (tagFilter) {
    docWhere.tags = { some: { name: tagFilter } };
  }

  const [documentRows, totalDocuments, detailDocument, folderCountRows] =
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
        ? prisma.document.findFirst({
            where: { id: params.documentId, deletedAt: deletedFilter },
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
      // Direkte dokumentantall per mappe. Brukes til mappe-kortene og det
      // samlede bibliotektallet uten én telling per mappe.
      prisma.document.groupBy({
        by: ["folderId"],
        where: { deletedAt: deletedFilter },
        _count: { _all: true },
      }),
    ]);

  // Når søket går på tvers av mapper, viser hver rad hvor dokumentet ligger.
  // Detaljvisningen får også sti, uansett hvilken mappe brukeren kom fra.
  const pathMap =
    !useFolderScope || detailDocument?.folderId
      ? await folderPathMap([
          ...documentRows.map((doc) => doc.folderId),
          detailDocument?.folderId ?? null,
        ])
      : null;
  const documents = documentRows.map((doc) => ({
    ...doc,
    folderPath:
      pathMap && doc.folderId ? pathMap.get(doc.folderId) ?? null : null,
  }));
  const detailWithPath = detailDocument
    ? {
        ...detailDocument,
        folderPath: detailDocument.folderId
          ? pathMap?.get(detailDocument.folderId) ?? null
          : null,
      }
    : null;

  const directFolderCounts = new Map<string, number>();
  let libraryTotal = 0;
  let rootDocumentCount = 0;
  for (const row of folderCountRows) {
    const count = Number(row._count._all) || 0;
    libraryTotal += count;
    if (row.folderId) directFolderCounts.set(row.folderId, count);
    else rootDocumentCount += count;
  }

  // Mappekortene viser antall dokumenter i hele undermappen, ikke bare de som
  // ligger direkte i mappen. Da ser en tom overmappe med innhold fortsatt riktig ut.
  const childFolderIds = new Map<string, string[]>();
  for (const folder of allFolders) {
    if (!folder.parentId) continue;
    const siblings = childFolderIds.get(folder.parentId) ?? [];
    siblings.push(folder.id);
    childFolderIds.set(folder.parentId, siblings);
  }
  const subtreeCounts = new Map<string, number>();
  const counting = new Set<string>();
  function subtreeDocumentCount(folderIdToCount: string): number {
    const cached = subtreeCounts.get(folderIdToCount);
    if (cached !== undefined) return cached;
    if (counting.has(folderIdToCount)) return 0;
    counting.add(folderIdToCount);
    const children = childFolderIds.get(folderIdToCount) ?? [];
    const total =
      (directFolderCounts.get(folderIdToCount) ?? 0) +
      children.reduce((sum, childId) => sum + subtreeDocumentCount(childId), 0);
    counting.delete(folderIdToCount);
    subtreeCounts.set(folderIdToCount, total);
    return total;
  }
  const folderDocumentCounts: Record<string, number> = {};
  for (const folder of allFolders) {
    folderDocumentCounts[folder.id] = subtreeDocumentCount(folder.id);
  }

  // Sørg for at mappen som vises (og detaljens mappe) alltid finnes i
  // nedtrekkslisten, ellers kan et lagre uten endringer flytte dokumentet.
  const visibleFolderIds = [folderId, detailWithPath?.folderId].filter(
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
    detailDocument: detailWithPath,
    folderOptions,
    allTags,
    libraryTotal,
    rootDocumentCount,
    folderDocumentCounts,
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

  if (input.parentId) {
    const parent = await prisma.documentFolder.findUnique({
      where: { id: input.parentId },
      select: { id: true },
    });
    if (!parent) return fail("not_found");
  }

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

/** Gir en mappe nytt navn. Krever documents.manage. */
export async function renameFolder(
  actor: ServiceActor,
  input: { id?: unknown; name?: unknown },
): Promise<ServiceResult> {
  if (!actor.isActive || !can(actor, "documents.manage")) {
    return fail("forbidden");
  }

  const idParsed = documentIdSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
  });
  const nameParsed = documentFolderCreateSchema.safeParse({
    name: cleanText(input.name, { maxLength: LIMITS.title }),
  });
  if (!idParsed.success || !nameParsed.success) return fail("invalid");
  const id = idParsed.data.id;
  const name = nameParsed.data.name;

  const folder = await prisma.documentFolder.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!folder) return fail("not_found");

  await prisma.$transaction(async (tx) => {
    await tx.documentFolder.update({ where: { id }, data: { name } });
    await audit(tx, {
      entityType: "DocumentFolder",
      entityId: id,
      action: `Ga mappen nytt navn: ${folder.name} → ${name}`,
      actor: toAuditActor(actor),
    });
  });

  return ok(undefined);
}

/**
 * Flytter en mappe. Sjekker at målmappen finnes og at flyttingen ikke lager en
 * syklus (en mappe kan ikke flyttes inn i seg selv eller en undermappe).
 */
export async function moveFolder(
  actor: ServiceActor,
  input: { id?: unknown; parentId?: unknown },
): Promise<ServiceResult> {
  if (!actor.isActive || !can(actor, "documents.manage")) {
    return fail("forbidden");
  }

  const parsed = documentIdSchema.safeParse({
    id: cleanText(input.id, { maxLength: LIMITS.line }),
  });
  if (!parsed.success) return fail("invalid");
  const id = parsed.data.id;
  const rawParent = cleanText(input.parentId, { maxLength: LIMITS.line });
  const parentId = rawParent || null;

  const folder = await prisma.documentFolder.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!folder) return fail("not_found");
  if (parentId === id) return fail("invalid");

  if (parentId) {
    const target = await prisma.documentFolder.findUnique({
      where: { id: parentId },
      select: { id: true, name: true },
    });
    if (!target) return fail("not_found");

    // Gå oppover fra målmappen. Treffer vi mappen vi flytter, ville den blitt
    // sin egen forelder og forsvunnet fra treet.
    let cursor: string | null = parentId;
    let depth = 0;
    while (cursor) {
      if (cursor === id) return fail("invalid");
      const current: { parentId: string | null } | null =
        await prisma.documentFolder.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      if (!current) break;
      cursor = current.parentId;
      depth++;
      if (depth > MAX_FOLDER_DEPTH) return fail("invalid");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.documentFolder.update({
      where: { id },
      data: { parentId },
    });
    await audit(tx, {
      entityType: "DocumentFolder",
      entityId: id,
      action: `Flyttet mappen: ${folder.name}`,
      actor: toAuditActor(actor),
    });
  });

  return ok(undefined);
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

  // En mappe med innhold skal aldri slettes stilltiende: dokumentene ville
  // blitt liggende uten mappe (onDelete: SetNull). Brukeren må flytte eller
  // slette innholdet først.
  const outcome = await prisma.$transaction(async (tx) => {
    const documents = await tx.document.count({ where: { folderId: id } });
    const folders = await tx.documentFolder.count({
      where: { parentId: id },
    });
    if (documents > 0 || folders > 0) {
      return { blocked: true as const, documents, folders };
    }

    await tx.documentFolder.delete({ where: { id } });
    await audit(tx, {
      entityType: "DocumentFolder",
      entityId: id,
      action: `Slettet mappe: ${folder.name}`,
      actor: toAuditActor(actor),
    });
    return { blocked: false as const, documents: 0, folders: 0 };
  });

  if (outcome.blocked) {
    return fail("conflict", {
      documents: outcome.documents,
      folders: outcome.folders,
    });
  }

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

  const doc = await prisma.document.findFirst({
    where: { id: version.documentId, deletedAt: null },
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

  const doc = await prisma.document.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!doc) return fail("not_found");

  const actorId = actor.id;

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: doc.id },
      data: { deletedAt: new Date(), deletedBy: actor.name || actorId },
    });
    await audit(tx, {
      entityType: "Document",
      entityId: doc.id,
      action: `Slettet dokumentet «${doc.title}» (myk sletting – kan gjenopprettes)`,
      actor: toAuditActor({ ...actor, id: actorId }),
      metadata: { softDeleted: true },
    });
  });

  // Filen og versjonene beholdes, slik at dokumentet kan gjenopprettes.
  return ok(undefined);
}

/** Gjenoppretter et mykt slettet dokument. Bare administrator. */
export async function restoreDocument(
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
    select: { id: true, title: true, deletedAt: true },
  });
  if (!doc) return fail("not_found");
  if (!doc.deletedAt) return fail("invalid");

  const actorId = actor.id;

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: doc.id },
      data: { deletedAt: null, deletedBy: null },
    });
    await audit(tx, {
      entityType: "Document",
      entityId: doc.id,
      action: `Gjenopprettet dokumentet «${doc.title}»`,
      actor: toAuditActor({ ...actor, id: actorId }),
    });
  });

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

  const existing = await prisma.document.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) return fail("not_found");

  // Behold den gamle filen som en versjon før den byttes ut.
  const replacingFile = Boolean(fileUrl && fileUrl !== existing.filePath);

  // Filbyttet krever at brukeren faktisk eier den nye filen. Kravet, versjonen,
  // dokumentraden og revisjonen skjer i samme transaksjon.
  const claimed = await prisma.$transaction(async (tx) => {
    if (replacingFile && fileUrl) {
      const { claimed } = await claimUpload(tx, fileUrl, actor.id, {
        ownerType: "DOCUMENT",
        ownerId: id,
        departmentId: actor.departmentId,
        customerId: null,
      });
      if (!claimed) return false;

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

    return true;
  });

  if (!claimed) return fail("invalid");

  // Hvis filen ble byttet, trekk ut ny tekst i bakgrunnen.
  if (replacingFile && fileUrl) {
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
    // Dokumentfiler lastes opp med ownerId null. Kravet skjer før raden
    // opprettes, og ownerId settes til dokumentets id i samme transaksjon.
    const { claimed } = await claimUpload(tx, fileUrl, actor.id, {
      ownerType: "DOCUMENT",
      ownerId: null,
      departmentId: actor.departmentId,
      customerId: null,
    });
    if (!claimed) return null;

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

    await tx.upload.updateMany({
      where: {
        storedName: fileUrl.slice("/uploads/".length),
        ownerType: "DOCUMENT",
        ownerId: null,
      },
      data: { ownerId: created.id },
    });

    await audit(tx, {
      entityType: "Document",
      entityId: created.id,
      action: `Lastet opp dokument: ${title}`,
      actor: toAuditActor(actor),
    });

    return created;
  });

  if (!newDoc) return fail("invalid");

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

export type DocumentBulkItemResult = {
  fileName: string;
  relativePath: string;
  status: "created" | "skipped" | "failed";
  reason?:
    | "duplicate"
    | "not_pdf"
    | "not_owned"
    | "invalid"
    | "folder_failed"
    | "error";
  id?: string;
  title?: string;
};

export type DocumentBulkResult = {
  created: number;
  skipped: number;
  failed: number;
  results: DocumentBulkItemResult[];
};

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function relativeDir(relativePath: string): string {
  const normalized = path.posix.normalize(normalizeRelativePath(relativePath));
  const dir = path.posix.dirname(normalized);
  if (dir === "." || dir.startsWith("..")) return "";
  return dir;
}

export async function bulkCreateDocuments(
  actor: ServiceActor,
  input: { itemsJson?: unknown; folderId: string | null },
): Promise<ServiceResult<DocumentBulkResult>> {
  if (!actor.isActive || !can(actor, "documents.manage")) {
    return fail("forbidden");
  }

  // Nok plass til store mappestrukturer uten å gjøre forespørselen ubegrenset.
  const itemsJson = cleanText(input.itemsJson, { maxLength: 500000 });
  if (!itemsJson) return fail("invalid");
  const items = parseBulkItems(itemsJson);
  if (!items) return fail("invalid");
  if (items.length > MAX_BULK_ITEMS) return fail("invalid");
  if (items.some((item) => !isUploadUrl(item.fileUrl))) return fail("invalid");

  const baseFolderId = input.folderId
    ? cleanText(input.folderId, { maxLength: LIMITS.line })
    : null;
  if (baseFolderId) {
    const baseFolder = await prisma.documentFolder.findUnique({
      where: { id: baseFolderId },
      select: { id: true },
    });
    if (!baseFolder) return fail("invalid");
  }

  // Mappe: relativ sti -> DocumentFolder id
  const folderMap = new Map<string, string | null>();
  folderMap.set("", baseFolderId);

  // Samle alle unike mapper
  const dirs = new Set<string>();
  for (const item of items) {
    const dirRel = relativeDir(item.relativePath);
    if (dirRel) {
      // Legg til alle foreldre-mapper
      const parts = dirRel.split("/").filter(Boolean);
      let acc = "";
      for (const part of parts) {
        acc = acc ? acc + "/" + part : part;
        dirs.add(acc);
      }
    }
  }

  // Opprett mapper (sortert slik at foreldre kommer først). En enkelt mappe
  // som ikke kan opprettes skal ikke stoppe hele importen; filene i den
  // mappen rapporteres som feilet i stedet.
  const failedDirs = new Set<string>();
  const sortedDirs = Array.from(dirs).sort(
    (a, b) => a.split("/").length - b.split("/").length,
  );
  for (const dirRel of sortedDirs) {
    const parts = dirRel.split("/");
    const name = parts[parts.length - 1];
    const parentRel = parts.slice(0, -1).join("/");
    const parentKey = parentRel || "";
    if (parentKey && failedDirs.has(parentKey)) {
      failedDirs.add(dirRel);
      continue;
    }
    const parentId = folderMap.get(parentKey) ?? baseFolderId;
    try {
      // Sjekk om mappen allerede finnes
      const existing = await prisma.documentFolder.findFirst({
        where: { name, parentId: parentId || null },
        select: { id: true },
      });
      if (existing) {
        folderMap.set(dirRel, existing.id);
      } else {
        const created = await prisma.documentFolder.create({
          data: { name, parentId: parentId || null },
        });
        folderMap.set(dirRel, created.id);
      }
    } catch (error) {
      console.error(`Kunne ikke opprette mappen «${dirRel}»:`, error);
      failedDirs.add(dirRel);
    }
  }

  const results: DocumentBulkItemResult[] = [];
  let createdCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const addResult = (result: DocumentBulkItemResult) => {
    results.push(result);
    if (result.status === "created") createdCount++;
    else if (result.status === "skipped") skippedCount++;
    else failedCount++;
  };

  // Opprett dokumenter. Hver fil behandles for seg: én feil skal ikke stoppe
  // resten av importen.
  for (const item of items) {
    const dirKey = relativeDir(item.relativePath);
    const targetFolderId = folderMap.get(dirKey) ?? baseFolderId;
    const fileName = cleanText(item.fileName, { maxLength: LIMITS.line }) ||
      "dokument.pdf";
    const relativePath = normalizeRelativePath(item.relativePath);
    const fileSize = Math.max(0, Math.trunc(item.fileSize || 0));

    const failedAncestor = [...failedDirs].some(
      (dir) => dirKey === dir || dirKey.startsWith(`${dir}/`),
    );
    if (failedAncestor) {
      addResult({
        fileName,
        relativePath,
        status: "failed",
        reason: "folder_failed",
      });
      continue;
    }

    // Bulkimport er bare for PDF-er. Andre filer holdes synlige i resultatet
    // som hoppet over, slik at brukeren ser hva som ikke ble importert.
    if (!fileName.toLowerCase().endsWith(".pdf")) {
      try {
        await removeOrphanedUpload(actor.id, item.fileUrl);
      } catch (error) {
        console.error("Kunne ikke rydde ikke-PDF-opplasting:", error);
      }
      addResult({
        fileName,
        relativePath,
        status: "skipped",
        reason: "not_pdf",
      });
      continue;
    }

    try {
      // Server-side duplikatkontroll i målmappen. Spørringen er avgrenset til
      // filnavn + størrelse + mappe og avhenger ikke av en forhåndslastet
      // liste med vilkårlig tak.
      const existing = await prisma.document.findFirst({
        where: {
          fileName,
          fileSize,
          folderId: targetFolderId || null,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        // Den nye opplastingen blir aldri knyttet til dokumentet; fjern den.
        try {
          await removeOrphanedUpload(actor.id, item.fileUrl);
        } catch (error) {
          console.error("Kunne ikke rydde duplikatopplasting:", error);
        }
        addResult({
          fileName,
          relativePath,
          status: "skipped",
          reason: "duplicate",
        });
        continue;
      }

      const documentTitle =
        cleanText(item.title, { maxLength: LIMITS.title }) ||
        path.basename(fileName, path.extname(fileName)) ||
        "dokument";

      const newDoc = await prisma.$transaction(async (tx) => {
        const { claimed } = await claimUpload(tx, item.fileUrl, actor.id, {
          ownerType: "DOCUMENT",
          ownerId: null,
          departmentId: actor.departmentId,
          customerId: null,
        });
        if (!claimed) return null;

        const created = await tx.document.create({
          data: {
            title: documentTitle,
            fileName,
            filePath: item.fileUrl,
            fileSize,
            mimeType: "application/pdf",
            folderId: targetFolderId || null,
            uploadedBy: actor.name || "Kontor",
          },
        });

        await tx.upload.updateMany({
          where: {
            storedName: item.fileUrl.slice("/uploads/".length),
            ownerType: "DOCUMENT",
            ownerId: null,
          },
          data: { ownerId: created.id },
        });

        await audit(tx, {
          entityType: "Document",
          entityId: created.id,
          action: `Lastet opp dokument: ${documentTitle}`,
          actor: toAuditActor(actor),
        });

        return created;
      });

      if (!newDoc) {
        addResult({
          fileName,
          relativePath,
          status: "failed",
          reason: "not_owned",
        });
        continue;
      }

      // Ekstraher PDF-tekst (best-effort, legges i bakgrunnskø). En feil her
      // skal ikke gjøre at en allerede opprettet fil rapporteres som feilet.
      try {
        enqueuePdfText(newDoc.id, item.fileUrl);
      } catch (error) {
        console.error("Kunne ikke legge PDF-tekst i kø:", error);
      }

      addResult({
        id: newDoc.id,
        title: documentTitle,
        fileName,
        relativePath,
        status: "created",
      });
    } catch (error) {
      console.error(`Bulk-import feilet for «${relativePath}»:`, error);
      addResult({
        fileName,
        relativePath,
        status: "failed",
        reason: "error",
      });
    }
  }

  if (createdCount > 0 || skippedCount > 0 || failedCount > 0) {
    console.info(
      `Bulk-opplasting av dokumenter: ${createdCount} nye filer` +
        (skippedCount > 0 ? `, ${skippedCount} hoppet over` : "") +
        (failedCount > 0 ? `, ${failedCount} feilet` : ""),
    );
  }

  return ok({
    created: createdCount,
    skipped: skippedCount,
    failed: failedCount,
    results,
  });
}

type SelectedDocument = { id: string; title: string };

async function findSelectedDocuments(
  ids: string[],
): Promise<Map<string, SelectedDocument>> {
  const documents = await prisma.document.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, title: true },
    take: MAX_BULK_SELECTION,
  });
  return new Map(documents.map((doc) => [doc.id, doc]));
}

function outcomeForMissing(id: string): DocumentBulkItemOutcome {
  return { id, title: "", status: "failed", reason: "not_found" };
}

/** Flytter flere dokumenter til en mappe (eller til rot med `null`). */
export async function bulkMoveDocuments(
  actor: ServiceActor,
  input: { ids?: unknown; folderId?: unknown },
): Promise<ServiceResult<DocumentBulkMutationResult>> {
  if (!actor.isActive || !can(actor, "documents.manage")) {
    return fail("forbidden");
  }

  const ids = parseBulkIds(input.ids);
  if (!ids) return fail("invalid");
  const rawFolderId = cleanText(input.folderId, { maxLength: LIMITS.line });
  const folderId = rawFolderId || null;

  let folderName: string | null = null;
  if (folderId) {
    const target = await prisma.documentFolder.findUnique({
      where: { id: folderId },
      select: { id: true, name: true },
    });
    if (!target) return fail("invalid");
    folderName = target.name;
  }

  const selected = await findSelectedDocuments(ids);
  const results: DocumentBulkItemOutcome[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const id of ids) {
    const doc = selected.get(id);
    if (!doc) {
      results.push(outcomeForMissing(id));
      failed++;
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.document.update({
          where: { id },
          data: { folderId },
        });
        await audit(tx, {
          entityType: "Document",
          entityId: id,
          action: folderName
            ? `Flyttet dokumentet «${doc.title}» til mappen ${folderName}`
            : `Flyttet dokumentet «${doc.title}» til rot`,
          actor: toAuditActor(actor),
        });
      });
      results.push({ id, title: doc.title, status: "ok" });
      succeeded++;
    } catch (error) {
      console.error(`Kunne ikke flytte dokument ${id}:`, error);
      results.push({
        id,
        title: doc.title,
        status: "failed",
        reason: "error",
      });
      failed++;
    }
  }

  return ok({ succeeded, failed, results });
}

/** Myksletter flere dokumenter. Bare administrator, som enkelt-sletting. */
export async function bulkDeleteDocuments(
  actor: ServiceActor,
  input: { ids?: unknown },
): Promise<ServiceResult<DocumentBulkMutationResult>> {
  if (!isAdminActor(actor) || !actor.isActive) return fail("forbidden");

  const ids = parseBulkIds(input.ids);
  if (!ids) return fail("invalid");
  const selected = await findSelectedDocuments(ids);
  const deletedAt = new Date();
  const deletedBy = actor.name || actor.id;
  const results: DocumentBulkItemOutcome[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const id of ids) {
    const doc = selected.get(id);
    if (!doc) {
      results.push(outcomeForMissing(id));
      failed++;
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.document.update({
          where: { id },
          data: { deletedAt, deletedBy },
        });
        await audit(tx, {
          entityType: "Document",
          entityId: id,
          action: `Slettet dokumentet «${doc.title}» (myk sletting – kan gjenopprettes)`,
          actor: toAuditActor(actor),
          metadata: { softDeleted: true, bulk: true },
        });
      });
      results.push({ id, title: doc.title, status: "ok" });
      succeeded++;
    } catch (error) {
      console.error(`Kunne ikke slette dokument ${id}:`, error);
      results.push({
        id,
        title: doc.title,
        status: "failed",
        reason: "error",
      });
      failed++;
    }
  }

  return ok({ succeeded, failed, results });
}

/** Legger til én eller flere tagger på flere dokumenter (legger til, erstatter ikke). */
export async function bulkTagDocuments(
  actor: ServiceActor,
  input: { ids?: unknown; tagNames?: unknown[] },
): Promise<ServiceResult<DocumentBulkMutationResult>> {
  if (!actor.isActive || !can(actor, "documents.manage")) {
    return fail("forbidden");
  }

  const ids = parseBulkIds(input.ids);
  if (!ids) return fail("invalid");
  const tagNames = [
    ...new Set(
      (Array.isArray(input.tagNames) ? input.tagNames : [])
        .map((tag) => cleanText(tag, { maxLength: LIMITS.short }))
        .filter(Boolean),
    ),
  ].slice(0, 20);
  if (tagNames.length === 0) return fail("invalid");

  const selected = await findSelectedDocuments(ids);
  const results: DocumentBulkItemOutcome[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const id of ids) {
    const doc = selected.get(id);
    if (!doc) {
      results.push(outcomeForMissing(id));
      failed++;
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.document.update({
          where: { id },
          data: {
            tags: {
              connectOrCreate: tagNames.map((name) => ({
                where: { name },
                create: { name },
              })),
            },
          },
        });
        await audit(tx, {
          entityType: "Document",
          entityId: id,
          action: `La til tagger på dokumentet «${doc.title}»: ${tagNames.join(", ")}`,
          actor: toAuditActor(actor),
        });
      });
      results.push({ id, title: doc.title, status: "ok" });
      succeeded++;
    } catch (error) {
      console.error(`Kunne ikke tagge dokument ${id}:`, error);
      results.push({
        id,
        title: doc.title,
        status: "failed",
        reason: "error",
      });
      failed++;
    }
  }

  return ok({ succeeded, failed, results });
}

/**
 * Rydder opp i opplastinger som aldri ble knyttet til et dokument. Kalles når
 * en import avbrytes, og fjerner bare filer aktøren selv lastet opp.
 */
export async function discardDocumentUploads(
  actor: ServiceActor,
  input: { fileUrls?: unknown },
): Promise<ServiceResult<{ deleted: number }>> {
  if (!actor.isActive || !can(actor, "documents.manage")) {
    return fail("forbidden");
  }

  const raw = Array.isArray(input.fileUrls) ? input.fileUrls : [];
  const fileUrls = [
    ...new Set(
      raw
        .map((value) => cleanUrl(value))
        .filter((value) => isUploadUrl(value)),
    ),
  ].slice(0, MAX_BULK_ITEMS);

  let deleted = 0;
  for (const fileUrl of fileUrls) {
    try {
      if (await removeOrphanedUpload(actor.id, fileUrl)) deleted++;
    } catch (error) {
      console.error(`Kunne ikke rydde opplastingen ${fileUrl}:`, error);
    }
  }

  return ok({ deleted });
}

/** Sender manglende PDF-er til fulltekst-indeksering på nytt. */
export async function reindexDocuments(
  actor: ServiceActor,
): Promise<ServiceResult<{ queued: number }>> {
  if (!can(actor, "documents.manage")) return fail("forbidden");

  const docs = await prisma.document.findMany({
    where: {
      deletedAt: null,
      OR: [{ contentText: null }, { contentText: "" }],
    },
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
