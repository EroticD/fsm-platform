import { authenticateApiRequest } from "@/lib/api-auth";
import { apiError, apiJson } from "@/lib/api-response";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_FOLDER_DEPTH = 50;

type FolderRow = { name: string; parentId: string | null };

/**
 * Bygger en lesbar mappesti fra dokumentets mappe og oppover.
 *
 * Dybden er begrenset, og en syklus kan ikke gi en uendelig løkke. Stien er
 * bare til visning; den inneholder ingen filsystembaner.
 */
async function folderPathFor(folder: FolderRow | null): Promise<string | null> {
  if (!folder) return null;

  const names = [folder.name];
  const seen = new Set<string>();
  let parentId = folder.parentId;
  let depth = 0;

  while (parentId && depth < MAX_FOLDER_DEPTH && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = await prisma.documentFolder.findUnique({
      where: { id: parentId },
      select: { name: true, parentId: true },
    });
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
    depth++;
  }

  return names.join(" / ");
}

/**
 * Ett dokuments metadata, mappesti og versjonshistorikk.
 *
 * Verken dokumentet eller versjonene eksponerer `filePath`, og selve filen
 * serveres ikke gjennom dette endepunktet. Slettede dokumenter gir 404.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "documents.view")) {
    return apiError(403, "forbidden", "Du har ikke tilgang til dokumenter.");
  }

  const { id } = await params;
  const document = await prisma.document.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      uploadedBy: true,
      createdAt: true,
      updatedAt: true,
      folder: { select: { id: true, name: true, parentId: true } },
      tags: { select: { id: true, name: true, color: true } },
      versions: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          createdBy: true,
          createdAt: true,
        },
      },
      _count: { select: { versions: true } },
    },
  });

  if (!document) {
    return apiError(404, "not_found", "Fant ikke dokumentet.");
  }

  const { _count, folder, versions, ...metadata } = document;
  const folderPath = await folderPathFor(folder);

  return apiJson({
    ...metadata,
    folder: folder ? { id: folder.id, name: folder.name } : null,
    folderPath,
    versions,
    versionsCount: _count.versions,
  });
}
