import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import path from "path";
import { enqueuePdfText } from "@/lib/pdf-queue";
import { LIMITS, cleanText, cleanUrl } from "@/lib/sanitize";
import { isOffice, requireOffice } from "@/lib/session";
import TagSelector from "@/components/TagSelector";
import MarkdownView from "@/components/MarkdownView";
import UploadDocumentForm from "./UploadDocumentForm";
import BulkUploadForm from "./BulkUploadForm";
import EditDocumentForm from "./EditDocumentForm";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; q?: string; tag?: string }>;
}) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) redirect("/api/auth/signin");
  const office = isOffice(user.role);

  const resolved = await searchParams;
  const folderId = resolved.folder || null;
  const searchQuery = resolved.q?.trim() || "";
  const tagFilter = resolved.tag || "";

  // Hent nåværende mappe + breadcrumb-sti
  let currentFolder: any = null;
  const breadcrumb: any[] = [];
  if (folderId) {
    currentFolder = await prisma.documentFolder.findUnique({ where: { id: folderId } });
    let cur = currentFolder;
    while (cur) {
      breadcrumb.unshift(cur);
      if (cur.parentId) {
        cur = await prisma.documentFolder.findUnique({ where: { id: cur.parentId } });
      } else {
        cur = null;
      }
    }
  }

  // Undermapper i nåværende mappe
  const subFolders = await prisma.documentFolder.findMany({
    where: { parentId: folderId },
    orderBy: { name: "asc" },
  });

  // Alle mapper (for redigerings-skjemaet)
  const allFolders = await prisma.documentFolder.findMany({ orderBy: { name: "asc" } });

  // Dokumenter i nåværende mappe (med søk og tag-filter)
  const docWhere: any = { folderId };
  if (searchQuery) {
    docWhere.OR = [
      { title: { contains: searchQuery, mode: "insensitive" } },
      { description: { contains: searchQuery, mode: "insensitive" } },
      { fileName: { contains: searchQuery, mode: "insensitive" } },
      { tags: { some: { name: { contains: searchQuery, mode: "insensitive" } } } },
    ];
  }
  if (tagFilter) {
    docWhere.tags = { some: { name: tagFilter } };
  }

  const documents = await prisma.document.findMany({
    where: docWhere,
    include: { tags: true },
    orderBy: { title: "asc" },
  });

  // Alle tags for filter
  const allTags = await prisma.documentTag.findMany({ orderBy: { name: "asc" } });

  // --- SERVER ACTIONS ---
  async function createFolder(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;
    const name = cleanText(formData.get("name"), { maxLength: LIMITS.title });
    if (!name) return;
    await prisma.documentFolder.create({
      data: { name, parentId: folderId },
    });
    await prisma.auditLog.create({
      data: {
        entityType: "DocumentFolder",
        entityId: name,
        action: `Opprettet mappe: ${name}`,
        userName: user?.name || "Kontor",
      },
    });
    revalidatePath("/dokumenter");
  }

  async function deleteFolder(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;
    const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
    if (!id) return;
    const f = await prisma.documentFolder.findUnique({ where: { id } });
    await prisma.documentFolder.delete({ where: { id } });
    await prisma.auditLog.create({
      data: {
        entityType: "DocumentFolder",
        entityId: id,
        action: `Slettet mappe: ${f?.name || "Ukjent"}`,
        userName: user?.name || "Kontor",
      },
    });
    revalidatePath("/dokumenter");
  }

  async function deleteDocument(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;
    const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
    if (!id) return;
    const doc = await prisma.document.findUnique({ where: { id } });
    await prisma.document.delete({ where: { id } });
    await prisma.auditLog.create({
      data: {
        entityType: "Document",
        entityId: id,
        action: `Slettet dokument: ${doc?.title || "Ukjent"}`,
        userName: user?.name || "Kontor",
      },
    });
    revalidatePath("/dokumenter");
  }

  // --- SERVER ACTION: OPPDATER DOKUMENT (mappe, tags, tittel, fil) ---
  async function updateDocument(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;
    const id = cleanText(formData.get("id"), { maxLength: LIMITS.line });
    if (!id) return;

    const title = cleanText(formData.get("title"), { maxLength: LIMITS.title });
    const description = cleanText(formData.get("description"), { maxLength: LIMITS.text });
    const folderId = cleanText(formData.get("folderId"), { maxLength: LIMITS.line }) || null;
    const fileUrl = cleanUrl(formData.get("fileUrl"));
    const fileName = cleanText(formData.get("fileName"), { maxLength: LIMITS.line });
    const fileSize = parseInt(cleanText(formData.get("fileSize"), { maxLength: LIMITS.line }) || "0", 10) || 0;
    const tagNames = formData.getAll("tags")
      .map(t => cleanText(t, { maxLength: LIMITS.short }))
      .filter(Boolean);

    if (!title) return;

    const existing = await prisma.document.findUnique({ where: { id } });
    if (!existing) return;

    await prisma.document.update({
      where: { id },
      data: {
        title,
        description: description || null,
        folderId,
        tags: {
          set: [],
          connectOrCreate: tagNames.map(name => ({ where: { name }, create: { name } })),
        },
        // Filen kan byttes ut – da oppdateres sti/størrelse
        ...(fileUrl ? { filePath: fileUrl } : {}),
        ...(fileName ? { fileName } : {}),
        ...(fileSize ? { fileSize } : {}),
      },
    });

    // Hvis filen ble byttet, trekk ut ny tekst i bakgrunnen
    if (fileUrl && fileUrl !== existing.filePath) {
      enqueuePdfText(id, fileUrl);
    }

    await prisma.auditLog.create({
      data: {
        entityType: "Document",
        entityId: id,
        action: `Oppdaterte dokument: ${title}`,
        userName: user?.name || "Kontor",
      },
    });
    revalidatePath("/dokumenter");
  }

  async function createDocument(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;
    const title = cleanText(formData.get("title"), { maxLength: LIMITS.title });
    const description = cleanText(formData.get("description"), { maxLength: LIMITS.text });
    const fileUrl = cleanUrl(formData.get("fileUrl"));
    const fileName = cleanText(formData.get("fileName"), { maxLength: LIMITS.line });
    const fileSize = parseInt(cleanText(formData.get("fileSize"), { maxLength: LIMITS.line }) || "0", 10) || 0;
    const targetFolderId = cleanText(formData.get("folderId"), { maxLength: LIMITS.line }) || null;
    const tagNames = formData.getAll("tags")
      .map(t => cleanText(t, { maxLength: LIMITS.short }))
      .filter(Boolean);

    if (!title || !fileUrl) return;

    const newDoc = await prisma.document.create({
      data: {
        title,
        description: description || null,
        fileName: fileName || "dokument.pdf",
        filePath: fileUrl,
        fileSize,
        mimeType: "application/pdf",
        folderId: targetFolderId,
        tags: {
          connectOrCreate: tagNames.map(name => ({
            where: { name },
            create: { name },
          })),
        },
        uploadedBy: user?.name || "Kontor",
      },
    });

    // Ekstraher PDF-tekst for fulltekst-søk i bakgrunnen (best-effort)
    enqueuePdfText(newDoc.id, fileUrl);

    await prisma.auditLog.create({
      data: {
        entityType: "Document",
        entityId: title,
        action: `Lastet opp dokument: ${title}`,
        userName: user?.name || "Kontor",
      },
    });
    revalidatePath("/dokumenter");
  }

  // --- SERVER ACTION: BULK OPPRETT DOKUMENTER (fra klient-opplastet mappe) ---
  async function bulkCreateDocuments(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;
    const itemsJson = cleanText(formData.get("items"), { maxLength: 100000 });
    if (!itemsJson) return;

    let items: { title: string; fileUrl: string; fileName: string; fileSize: number; relativePath: string }[] = [];
    try {
      items = JSON.parse(itemsJson);
    } catch {
      return;
    }
    if (!Array.isArray(items) || items.length === 0) return;

    // Mappe: relativ sti -> DocumentFolder id
    const folderMap = new Map<string, string | null>();
    folderMap.set("", folderId);

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
    const sortedDirs = Array.from(dirs).sort((a, b) => a.split("/").length - b.split("/").length);
    for (const dirRel of sortedDirs) {
      const parts = dirRel.split("/");
      const name = parts[parts.length - 1];
      const parentRel = parts.slice(0, -1).join("/");
      const parentKey = parentRel || "";
      const parentId = folderMap.get(parentKey) ?? folderId;
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
      if (!item.fileUrl) continue;
      const dirRel = path.dirname(item.relativePath || "");
      const dirKey = dirRel === "." ? "" : dirRel.replace(/\\/g, "/");
      const targetFolderId = folderMap.get(dirKey) ?? folderId;

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

      const newDoc = await prisma.document.create({
        data: {
          title: item.title || path.basename(item.fileName || "dokument", path.extname(item.fileName || ".pdf")),
          fileName: item.fileName || "dokument.pdf",
          filePath: item.fileUrl,
          fileSize: item.fileSize || 0,
          mimeType: "application/pdf",
          folderId: targetFolderId || null,
          uploadedBy: user?.name || "Kontor",
        },
      });

      // Ekstraher PDF-tekst (best-effort, legges i bakgrunnskø)
      enqueuePdfText(newDoc.id, item.fileUrl);

      count++;
    }

    await prisma.auditLog.create({
      data: {
        entityType: "Document",
        entityId: "bulk-upload",
        action: `Lastet opp mappestruktur: ${count} filer${skippedServer > 0 ? ` (${skippedServer} hoppet over)` : ""}`,
        userName: user?.name || "Kontor",
      },
    });
    revalidatePath("/dokumenter");
  }

  // --- SERVER ACTION: INDEKSER PÅ NYTT (ekstraher PDF-tekst) ---
  async function reindexDocuments() {
    "use server";
    if (!(await requireOffice())) return;
    const docs = await prisma.document.findMany({
      where: { OR: [{ contentText: null }, { contentText: "" }] },
      select: { id: true, filePath: true },
    });
    for (const doc of docs) {
      enqueuePdfText(doc.id, doc.filePath);
    }
    await prisma.auditLog.create({
      data: {
        entityType: "Document",
        entityId: "reindex",
        action: `Reindekserte ${docs.length} dokumenter for fulltekst-søk`,
        userName: user?.name || "Kontor",
      },
    });
    revalidatePath("/dokumenter");
  }

  const folderLink = (fid: string | null) => {
    const params = new URLSearchParams();
    if (fid) params.set("folder", fid);
    if (searchQuery) params.set("q", searchQuery);
    if (tagFilter) params.set("tag", tagFilter);
    const qs = params.toString();
    return `/dokumenter${qs ? `?${qs}` : ""}`;
  };

  const tagLink = (tagName: string) => {
    const params = new URLSearchParams();
    if (folderId) params.set("folder", folderId);
    if (searchQuery) params.set("q", searchQuery);
    if (tagName) params.set("tag", tagName);
    const qs = params.toString();
    return `/dokumenter${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900">📚 Dokumentbibliotek</h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">
              Brukermanualer og PDF-filer for feltarbeid. Søk og filtrer på tags.
            </p>
          </div>
          <Link href="/" className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap">
            ← Dashbord
          </Link>
        </div>

        {/* SØK + TAG-FILTER */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3">
          <form method="GET" action="/dokumenter" className="flex flex-wrap gap-2">
            {folderId && <input type="hidden" name="folder" value={folderId} />}
            {tagFilter && <input type="hidden" name="tag" value={tagFilter} />}
            <input
              type="search"
              name="q"
              defaultValue={searchQuery}
              placeholder="Søk i tittel, beskrivelse, filnavn eller tags..."
              className="flex-1 min-w-[14rem] border-2 border-gray-200 p-2.5 rounded-xl text-sm font-medium text-gray-900 bg-gray-50 outline-none focus:border-blue-700"
            />
            <button type="submit" className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition">
              Søk
            </button>
            {(searchQuery || tagFilter) && (
              <Link
                href={folderLink(folderId)}
                className="bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-300 transition"
              >
                Nullstill
              </Link>
            )}
          </form>

          {/* Tag-filter chips */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider self-center">Filter på tag:</span>
              {allTags.map((tag) => (
                <Link
                  key={tag.id}
                  href={tagFilter === tag.name ? folderLink(folderId) : tagLink(tag.name)}
                  className={`px-3 py-1 rounded-full text-xs font-bold border-2 transition ${
                    tagFilter === tag.name
                      ? "text-white border-transparent"
                      : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
                  }`}
                  style={tagFilter === tag.name ? { backgroundColor: tag.color } : {}}
                >
                  🏷️ {tag.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* BREADCRUMB */}
        <div className="flex items-center gap-2 text-sm font-bold text-gray-600 flex-wrap">
          <Link href="/dokumenter" className="hover:text-blue-700 transition">📁 Rot</Link>
          {breadcrumb.map((f, i) => (
            <span key={f.id} className="flex items-center gap-2">
              <span className="text-gray-400">/</span>
              {i === breadcrumb.length - 1 ? (
                <span className="text-gray-900">{f.name}</span>
              ) : (
                <Link href={folderLink(f.id)} className="hover:text-blue-700 transition">{f.name}</Link>
              )}
            </span>
          ))}
        </div>

        {/* UNDERMAPPER */}
        {subFolders.length > 0 && (
          <div>
            <h2 className="text-sm font-black text-gray-500 uppercase tracking-wider mb-3">Undermapper</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {subFolders.map((f) => (
                <Link
                  key={f.id}
                  href={folderLink(f.id)}
                  className="bg-white p-4 rounded-2xl shadow-sm border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition text-center"
                >
                  <div className="text-3xl mb-1">📁</div>
                  <p className="font-bold text-gray-900 text-sm truncate">{f.name}</p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* DOKUMENTER */}
        <div>
          <h2 className="text-sm font-black text-gray-500 uppercase tracking-wider mb-3">
            Dokumenter ({documents.length})
          </h2>
          {documents.length === 0 ? (
            <div className="bg-white p-8 rounded-2xl shadow-sm border-2 border-dashed border-gray-300 text-center">
              <p className="text-gray-600 font-bold">Ingen dokumenter i denne mappen.</p>
              <p className="text-xs text-gray-500 mt-1">
                {searchQuery || tagFilter
                  ? "Prøv et annet søkeord eller fjern filteret."
                  : "Last opp en PDF nedenfor."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="bg-white p-3 sm:p-4 rounded-2xl border-2 border-gray-200 hover:border-blue-400 hover:shadow-md transition space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xl">📄</span>
                        <p className="font-black text-gray-900 truncate">{doc.title}</p>
                      </div>
                      {doc.description && (
                        <p className="text-xs text-gray-600 mt-1 line-clamp-2">{doc.description}</p>
                      )}
                      <p className="text-[10px] text-gray-500 mt-1">
                        {doc.fileName} • {(doc.fileSize / 1024).toFixed(0)} KB
                        {doc.uploadedBy ? ` • Lastet opp av ${doc.uploadedBy}` : ""}
                      </p>
                      {doc.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {doc.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="text-white px-2 py-0.5 rounded-full text-[9px] font-bold shadow-sm"
                              style={{ backgroundColor: tag.color || "#3b82f6" }}
                            >
                              🏷️ {tag.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                      <a
                        href={doc.filePath}
                        target="_blank"
                        rel="noreferrer"
                        className="bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-800 transition shadow-sm whitespace-nowrap"
                      >
                        📖 Åpne PDF
                      </a>
                      {office && (
                        <EditDocumentForm
                          doc={doc}
                          allFolders={allFolders}
                          allTags={allTags}
                          updateDocument={updateDocument}
                        />
                      )}
                      {office && (
                        <ConfirmSubmitForm action={deleteDocument} confirmMessage={`Slette dokumentet «${doc.title}»?`}>
                          <input type="hidden" name="id" value={doc.id} />
                          <button
                            type="submit"
                            className="text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 px-3 py-2 rounded-xl border border-red-200 transition whitespace-nowrap"
                          >
                            🗑️ Slett
                          </button>
                        </ConfirmSubmitForm>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* OPPLASTING + NY MAPPE (kontor only) */}
        {office && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* NY MAPPE */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold text-gray-900 mb-4">📁 Opprett ny mappe</h2>
              <form action={createFolder} className="flex gap-3">
                <input
                  type="text"
                  name="name"
                  placeholder="Navn på mappe"
                  required
                  className="flex-1 min-w-0 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500"
                />
                <button type="submit" className="bg-[var(--primary-color)] text-white px-5 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm whitespace-nowrap">
                  + Opprett
                </button>
              </form>
            </div>

            {/* LAST OPP DOKUMENT */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-bold text-gray-900 mb-4">⬆️ Last opp PDF</h2>
              <UploadDocumentForm folderId={folderId} allTags={allTags} createDocument={createDocument} />
            </div>

            {/* LAST OPP MAPPESTRUKTUR */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 lg:col-span-2">
              <h2 className="text-lg font-bold text-gray-900 mb-2">📥 Last opp mappestruktur</h2>
              <p className="text-sm text-gray-500 mb-4">
                Velg en mappe på din PC. Alle PDF-filer lastes opp og undermapper opprettes automatisk.
              </p>
              <BulkUploadForm folderId={folderId} allTags={allTags} existingFiles={documents.map(d => ({ fileName: d.fileName, fileSize: d.fileSize }))} bulkCreateDocuments={bulkCreateDocuments} />

              <div className="border-t-2 border-gray-200 pt-4 mt-4">
                <form action={reindexDocuments}>
                  <button
                    type="submit"
                    className="w-full bg-gray-200 text-gray-700 py-2.5 rounded-xl font-bold hover:bg-gray-300 transition shadow-sm"
                  >
                    🔄 Indekser alle PDF-er for søk
                  </button>
                  <p className="text-xs text-gray-500 mt-2">
                    Ekstraherer tekst fra PDF-ene slik at innhold kan søkes på. Kjøres automatisk ved opplasting, men kan kjøres manuelt for å fylle ut manglende.
                  </p>
                </form>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}