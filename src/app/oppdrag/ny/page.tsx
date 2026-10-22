import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import CustomerSelect from "./CustomerSelect";
import MarkdownEditor from "@/components/MarkdownEditor";
import TagSelector from "@/components/TagSelector";
import { LIMITS, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { parseDateOnly } from "@/lib/dates";
import { getCurrentUser, requirePermission } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getActiveDepartments, getDefaultDepartmentId } from "@/lib/departments";
import { staffForDepartment, staffWhere } from "@/lib/access";
import { createWorkOrderSchema } from "./schemas";

export default async function AdminCreateWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.create")) redirect("/");

  const { error } = await searchParams;
  const isAdmin = user.role === "ADMIN";
  const departments = await getActiveDepartments();
  const defaultDepartmentId = await getDefaultDepartmentId();
  // Administrator kan opprette i alle avdelinger. Alle andre må selv være
  // knyttet til en avdeling – vi faller ikke tilbake til standardavdelingen.
  const ownDepartmentId = isAdmin
    ? (user.departmentId ?? defaultDepartmentId)
    : user.departmentId;

  const customers = await prisma.customer.findMany({ orderBy: { name: 'asc' } });
  const contacts = await prisma.contact.findMany({ orderBy: { name: 'asc' } });
  const templates = await prisma.template.findMany({ orderBy: { title: 'asc' } });
  const technicians = await prisma.user.findMany({
    where: isAdmin ? staffWhere() : staffForDepartment(ownDepartmentId),
    include: { department: true },
    orderBy: { name: "asc" },
  });
  const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });

  async function createWorkOrder(formData: FormData): Promise<void> {
    "use server";
    // Autorisasjonen må ligge i handlingen, ikke bare i sidevisningen.
    if (!(await requirePermission("workorders.create"))) return;
    const actor = await getCurrentUser();
    if (!actor) return;

    // Administrator kan velge avdeling, alle andre oppretter i egen avdeling.
    let departmentId: string | null = null;
    if (actor.role === "ADMIN") {
      const requested = cleanText(formData.get("departmentId"), { maxLength: LIMITS.line });
      if (requested) {
        const department = await prisma.department.findFirst({
          where: { id: requested, isActive: true },
          select: { id: true },
        });
        departmentId = department?.id ?? null;
      }
      departmentId = departmentId ?? (await getDefaultDepartmentId());
    } else {
      departmentId = actor.departmentId;
    }

    if (!departmentId) {
      redirect("/oppdrag/ny?error=avdeling");
    }

    const title = cleanText(formData.get("title"), { maxLength: LIMITS.title });
    const description = cleanMarkdown(formData.get("description"));
    const customerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
    const contactId = cleanText(formData.get("contactId"), { maxLength: LIMITS.line });
    const dateInput = cleanText(formData.get("scheduledFor"), { maxLength: LIMITS.line });
    const endInput = cleanText(formData.get("scheduledTo"), { maxLength: LIMITS.line });
    const scheduledFor = parseDateOnly(dateInput) ?? new Date();
    const parsedEnd = parseDateOnly(endInput);
    const scheduledTo = parsedEnd && parsedEnd > scheduledFor ? parsedEnd : null;

    // Kontaktpersonen må tilhøre den valgte kunden.
    let validContactId = contactId;
    if (contactId) {
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (!contact || contact.customerId !== customerId) validContactId = "";
    }

    const requestedTechnicianIds = formData.getAll("technicianIds") as string[];
    const templateIds = formData.getAll("templateIds") as string[];
    const tagNames = formData.getAll("tags")
      .map(t => cleanText(t, { maxLength: LIMITS.short }))
      .filter(Boolean);

    // Montører som ikke hører til oppdragets avdeling skal ikke kunne tildeles.
    const allowedTechnicians = requestedTechnicianIds.length
      ? await prisma.user.findMany({
          where: { id: { in: requestedTechnicianIds }, ...staffForDepartment(departmentId) },
          select: { id: true },
        })
      : [];
    const technicianIds = allowedTechnicians.map((technician) => technician.id);

    const parsed = createWorkOrderSchema.safeParse({
      title,
      description,
      customerId,
      contactId: validContactId,
      scheduledFor: dateInput,
      scheduledTo: endInput,
      technicianIds,
      templateIds,
    });

    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "Ugyldig data");
    }

    try {
      const newWo = await prisma.workOrder.create({
        data: {
          title,
          description: description || "",
          departmentId,
          customerId: customerId || undefined,
          contactId: parsed.data.contactId || undefined,
          scheduledFor,
          scheduledTo,
          creatorName: actor.name || actor.email || "Kontor",
          status: "PENDING",
          technicians: {
            connect: technicianIds.map(id => ({ id }))
          },
          templates: {
            connect: templateIds.map(id => ({ id }))
          },
          tags: {
            connectOrCreate: tagNames.map(name => ({
              where: { name },
              create: { name }
            }))
          }
        }
      });

      await prisma.auditLog.create({
        data: {
          entityType: "WorkOrder",
          entityId: newWo.id,
          action: `Kontoret opprettet nytt oppdrag: ${title}`,
          userName: actor.name || actor.email || "Admin"
        }
      });
    } catch (dbError) {
      console.error("Databasefeil ved opprettelse av oppdrag:", dbError);
      throw new Error("Kunne ikke opprette oppdrag");
    }

    // redirect() virker ved å kaste et spesialunntak (NEXT_REDIRECT), så kallet
    // må ligge utenfor try/catch – ellers blir omdirigeringen slukt og tolket
    // som en databasefeil.
    redirect("/kalender");
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <div>
            <h1 className="text-2xl font-black text-gray-900">➕ Opprett nytt oppdrag</h1>
            <p className="text-gray-500 text-sm">Planlegg en ny jobb og tildel ressurser.</p>
          </div>
          <Link href="/kalender" className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-300 transition text-sm">
            &larr; Tilbake til kalender
          </Link>
        </div>

        {error === "avdeling" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-5 py-4 text-sm font-bold">
            Oppdraget må tilhøre en avdeling. Be en administrator legge deg til i en
            aktiv avdeling, eller opprett en avdeling først.
          </div>
        )}

        <form action={createWorkOrder} className="bg-white p-6 rounded-2xl shadow-sm border space-y-5">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Avdeling</label>
            {isAdmin ? (
              <select
                name="departmentId"
                defaultValue={ownDepartmentId ?? ""}
                required
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                    {department.isDefault ? " (standard)" : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="w-full border border-gray-200 bg-gray-50 p-3 rounded-xl text-sm text-gray-800 font-bold">
                {user.department?.name || departments.find((d) => d.id === ownDepartmentId)?.name || "Ingen avdeling"}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Oppdraget blir bare synlig for ansatte i denne avdelingen.
            </p>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Oppdragstittel</label>
            <input
              type="text"
              name="title"
              placeholder="F.eks. Årlig service / Feilsøking"
              required
              className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"
            />
          </div>

          <CustomerSelect customers={customers} contacts={contacts} optional={true} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Dato for utførelse</label>
              <input type="date" name="scheduledFor" defaultValue={new Date().toISOString().split("T")[0]} required className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Til dato (valgfritt)</label>
              <input type="date" name="scheduledTo" className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium" />
              <p className="text-xs text-gray-500 mt-1">Siste dag oppdraget varer. Tom = éndagsoppdrag.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Tildel montører</label>
            <div className="max-h-40 overflow-y-auto bg-gray-50 p-3 rounded-xl border space-y-2">
              {technicians.map(tech => (
                <label key={tech.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-200 p-1.5 rounded-lg transition">
                  <input type="checkbox" name="technicianIds" value={tech.id} className="w-4 h-4 text-blue-600 rounded" />
                  <span className="font-medium text-gray-800 text-sm">
                    {tech.name}
                    {tech.department ? ` (${tech.department.name})` : ""}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Legg til sjekklister / skjemaer</label>
            <p className="text-xs text-gray-500 mb-2">Montøren må fylle ut alle skjemaene du krysser av for her.</p>
            <div className="max-h-40 overflow-y-auto bg-blue-50/50 p-3 rounded-xl border border-blue-100 space-y-2">
              {templates.map(t => (
                <label key={t.id} className="flex items-center gap-3 cursor-pointer hover:bg-blue-100 p-2 rounded-lg transition">
                  <input type="checkbox" name="templateIds" value={t.id} className="w-4 h-4 text-blue-600 rounded border-gray-300" />
                  <span className="font-bold text-blue-900 text-sm">{t.title}</span>
                </label>
              ))}
              {templates.length === 0 && <p className="text-sm text-gray-500 p-2">Ingen sjekklistemaler finnes i systemet.</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Tags</label>
            <TagSelector allTags={tags} />
            <p className="text-xs text-gray-500 mt-1">Brukes for å spore beredskap for fullføring / arbeid.</p>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Beskrivelse / Instrukser</label>
            <MarkdownEditor name="description" rows={3} placeholder="Skriv instruksjoner til montøren..." />
          </div>

          <button type="submit" className="w-full bg-[var(--primary-color)] text-white py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
            Lagre oppdrag
          </button>
        </form>
      </div>
    </div>
  );
}
