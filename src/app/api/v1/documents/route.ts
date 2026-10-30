import type { Prisma } from "@prisma/client";
import { authenticateApiRequest } from "@/lib/api-auth";
import { paginationMeta, parseApiPagination } from "@/lib/api-pagination";
import { apiError, apiJson } from "@/lib/api-response";
import { findDocumentIdsBySearch } from "@/lib/document-search";
import { hasPermission } from "@/lib/permissions";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_QUERY_LENGTH = 100;

/**
 * Dokumentbiblioteket uten filinnhold.
 *
 * Responsen inneholder bare metadata og en trygg mappe-referanse. Den rå
 * lagringsstien (`filePath`) brukes aldri utenfor serveren, og slettede
 * dokumenter er alltid utenfor API-et.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;

  if (!hasPermission(auth.actor, "documents.view")) {
    return apiError(403, "forbidden", "Du har ikke tilgang til dokumenter.");
  }

  const url = new URL(request.url);
  const { page, limit, skip } = parseApiPagination(url);
  const folderId = (url.searchParams.get("folderId") ?? "").trim();
  const tag = (url.searchParams.get("tag") ?? "").trim();
  const query = (url.searchParams.get("q") ?? "")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);

  const where: Prisma.DocumentWhereInput = { deletedAt: null };
  if (folderId) where.folderId = folderId;
  if (tag) where.tags = { some: { name: tag } };
  if (query) {
    where.id = { in: await findDocumentIdsBySearch(query) };
  }

  const [total, documents] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      orderBy: [{ title: "asc" }, { id: "asc" }],
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        folder: { select: { id: true, name: true } },
        tags: { select: { id: true, name: true, color: true } },
        updatedAt: true,
        uploadedBy: true,
      },
    }),
  ]);

  return apiJson(documents, paginationMeta(total, page, limit));
}
