import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import MarkdownEditor from "@/components/MarkdownEditor";
import TagSelector from "@/components/TagSelector";
import { LIMITS, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { parseDateOnly } from "@/lib/dates";
import { getCurrentUser, requirePermission } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getActiveDepartments } from "@/lib/departments";
import { staffForDepartment, staffWhere, workOrderScope } from "@/lib/access";

export default async function EditWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const workOrderId = resolvedParams.id;

  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.edit")) redirect("/");

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, ...workOrderScope(user) },
    include: {
      department: true,
      customer: true,
      technicians: { include: { department: true } },
      templates: true,
      tags: true
    }
  });

  if (!workOrder) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Oppdraget finnes ikke</h1>
        <Link href="/" className="text-blue-700 font-bold hover:underline">Tilbake til dashbord</Link>
      </div>
    );
  }

  const isAdmin = user.role === "ADMIN";
  const departments = isAdmin ? await getActiveDepartments() : [];

  // Avgrensede lister – skjemaet er ikke en katalog over alle kunder.
  const customers = await prisma.customer.findMany({
    orderBy: { name: 'asc' },
    take: 100,
    select: { id: true, name: true, city: true },
  });
  const technicians = await prisma.user.findMany({
    where: isAdmin ? staffWhere() : staffForDepartment(workOrder.departmentId),
    include: { department: true },
    orderBy: { name: 'asc' },
    take: 100,
  });
  const contacts = await prisma.contact.findMany({
    orderBy: { name: 'asc' },
    take: 200,
    select: { id: true, name: true, role: true, customerId: true },
  });
  const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });

  // Den valgte kunden, kontakten og montørene må alltid være med i listene,
  // ellers ville et lagre uten endringer kunne nullstille dem.
  const customerOptions = [...customers];
  if (
    workOrder.customerId &&
    !customerOptions.some((customer) => customer.id === workOrder.customerId)
  ) {
    const currentCustomer = await prisma.customer.findUnique({
      where: { id: workOrder.customerId },
      select: { id: true, name: true, city: true },
    });
    if (currentCustomer) customerOptions.unshift(currentCustomer);
  }

  const contactOptions = [...contacts];
  if (
    workOrder.contactId &&
    !contactOptions.some((contact) => contact.id === workOrder.contactId)
  ) {
    const currentContact = await prisma.contact.findUnique({
      where: { id: workOrder.contactId },
      select: { id: true, name: true, role: true, customerId: true },
    });
    if (currentContact) contactOptions.unshift(currentContact);
  }

  const technicianOptions = [...technicians];
  for (const assigned of workOrder.technicians) {
    if (!technicianOptions.some((technician) => technician.id === assigned.id)) {
      technicianOptions.push(assigned);
    }
  }

  // --- SERVER ACTION: LAGRE ENDRINGER ---
  async function updateWorkOrder(formData: FormData) {
    "use server";
    // Autorisasjonen må ligge i handlingen, ikke bare i sidevisningen.
    if (!(await requirePermission("workorders.edit"))) return;
    const actor = await getCurrentUser();
    if (!actor) return;

    const currentWorkOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, ...workOrderScope(actor) },
      select: { id: true, departmentId: true },
    });
    if (!currentWorkOrder) return;

    // Administrator kan flytte oppdraget til en annen aktiv avdeling.
    let departmentId = currentWorkOrder.departmentId;
    if (actor.role === "ADMIN") {
      const requested = cleanText(formData.get("departmentId"), { maxLength: LIMITS.line });
      if (requested) {
        const department = await prisma.department.findFirst({
          where: { id: requested, isActive: true },
          select: { id: true },
        });
        if (!department) return;
        departmentId = department.id;
      }
    }

    const title = cleanText(formData.get("title"), { maxLength: LIMITS.title });
    const description = cleanMarkdown(formData.get("description"));
    const customerId = cleanText(formData.get("customerId"), { maxLength: LIMITS.line });
    const scheduledFor = cleanText(formData.get("scheduledFor"), { maxLength: LIMITS.line });
    const scheduledToInput = cleanText(formData.get("scheduledTo"), { maxLength: LIMITS.line });
    const scheduledForDate = scheduledFor ? parseDateOnly(scheduledFor) : null;
    const scheduledToDate = scheduledToInput ? parseDateOnly(scheduledToInput) : null;
    const technicianIds = formData.getAll("technicianIds") as string[];
    let contactId = cleanText(formData.get("contactId"), { maxLength: LIMITS.line });
    const tagNames = formData.getAll("tags")
      .map(t => cleanText(t, { maxLength: LIMITS.short }))
      .filter(Boolean);

    if (!title || !customerId) return;
    if (scheduledToDate && scheduledForDate && scheduledToDate < scheduledForDate) return;

    // Kontaktpersonen må tilhøre den valgte kunden; ellers tømmes feltet.
    if (contactId) {
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (!contact || contact.customerId !== customerId) contactId = "";
    }

    // Bare ansatte i oppdragets avdeling kan tildeles.
    const allowedTechnicians = technicianIds.length
      ? await prisma.user.findMany({
          where: { id: { in: technicianIds }, ...staffForDepartment(departmentId) },
          select: { id: true },
          take: 100,
        })
      : [];
    const validTechnicianIds = allowedTechnicians.map((technician) => technician.id);

    // Oppdater grunnleggende info og bytt ut tildelte montører
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        title,
        description,
        departmentId,
        customerId,
        contactId: contactId || null,
        scheduledFor: scheduledForDate,
        scheduledTo: scheduledToDate && scheduledForDate && scheduledToDate > scheduledForDate
          ? scheduledToDate
          : null,
        technicians: { set: validTechnicianIds.map(id => ({ id })) },
        tags: {
          set: [],
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
        entityId: workOrderId,
        action: `Oppdaterte oppdraget: ${title}`,
        userName: actor.name || actor.email || "Ukjent"
      }
    });

    revalidatePath(`/oppdrag/${workOrderId}`);
    revalidatePath(`/`);
    redirect(`/oppdrag/${workOrderId}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="max-w-2xl mx-auto space-y-6">
        
        <div className="flex justify-between items-center border-b pb-6">
          <div>
            <h1 className="text-3xl font-black text-gray-900">✏️ Rediger Oppdrag</h1>
            <p className="text-gray-500 mt-1 text-sm font-medium">Oppdater detaljer, dato eller montør.</p>
          </div>
          <Link href={`/oppdrag/${workOrderId}`} className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm">
            &larr; Avbryt
          </Link>
        </div>

        <form action={updateWorkOrder} className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border-2 border-gray-200 space-y-6">
          
          <div>
            <label className="block text-sm font-black text-gray-900 mb-2">Oppdragstittel / Navn <span className="text-red-500">*</span></label>
            <input 
              type="text" 
              name="title" 
              defaultValue={workOrder.title} 
              required 
              className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
            />
          </div>

          <div>
            <label className="block text-sm font-black text-gray-900 mb-2">Avdeling</label>
            {isAdmin ? (
              <select
                name="departmentId"
                defaultValue={workOrder.departmentId}
                className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="w-full border-2 border-gray-200 bg-gray-50 p-3.5 rounded-xl text-base font-bold text-gray-800">
                {workOrder.department.name}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Flytter du oppdraget, må montører fra den nye avdelingen velges på nytt.
            </p>
          </div>

          <div>
            <label className="block text-sm font-black text-gray-900 mb-2">Kunde <span className="text-red-500">*</span></label>
            <select 
              name="customerId" 
              defaultValue={workOrder.customerId || undefined}
              required 
              className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
            >
              {customerOptions.map(c => (
                <option key={c.id} value={c.id}>{c.name} {c.city ? `(${c.city})` : ""}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-black text-gray-900 mb-2">Kontaktperson (valgfritt)</label>
            <select
              name="contactId"
              defaultValue={workOrder.contactId || ""}
              className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
            >
              <option value="">— Ingen kontaktperson —</option>
              {customerOptions.map(c => {
                const customerContacts = contactOptions.filter((k) => k.customerId === c.id);
                if (customerContacts.length === 0) return null;
                return (
                  <optgroup key={c.id} label={c.name}>
                    {customerContacts.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}{k.role ? ` (${k.role})` : ""}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Velger du en ny kunde, må du også velge kontaktperson på nytt.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-black text-gray-900 mb-2">Planlagt dato</label>
              <input
                type="date"
                name="scheduledFor"
                defaultValue={workOrder.scheduledFor ? new Date(workOrder.scheduledFor).toISOString().split('T')[0] : ""}
                className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
              />
            </div>
            <div>
              <label className="block text-sm font-black text-gray-900 mb-2">Til dato (valgfritt)</label>
              <input
                type="date"
                name="scheduledTo"
                defaultValue={workOrder.scheduledTo ? new Date(workOrder.scheduledTo).toISOString().split('T')[0] : ""}
                className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
              />
              <p className="text-xs text-gray-500 mt-1">Siste dag oppdraget varer. Tom = éndagsoppdrag.</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-black text-gray-900 mb-2">Tildelte montører</label>
            <p className="text-xs text-gray-500 mb-2">Kryss av alle som skal jobbe med oppdraget.</p>
            <div className="max-h-48 overflow-y-auto bg-gray-50 p-3 rounded-xl border-2 border-gray-200 space-y-1">
              {technicianOptions.map(t => (
                <label key={t.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-200 p-1.5 rounded-lg transition">
                  <input
                    type="checkbox"
                    name="technicianIds"
                    value={t.id}
                    defaultChecked={workOrder.technicians.some(wt => wt.id === t.id)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span className="font-medium text-gray-800 text-sm">
                    {t.name} ({t.role === 'ADMIN' ? 'Admin / Kontor' : t.role === 'OFFICE' ? 'Kontor' : 'Montør'})
                    {isAdmin && t.department ? ` – ${t.department.name}` : ""}
                  </span>
                </label>
              ))}
              {technicianOptions.length === 0 && (
                <p className="text-sm text-gray-500 p-2">Ingen ansatte funnet.</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-black text-gray-900 mb-2">Tags</label>
            <TagSelector allTags={tags} selectedTagNames={workOrder.tags.map((t: any) => t.name)} />
            <p className="text-xs text-gray-500 mt-1">Brukes for å spore beredskap for fullføring / arbeid.</p>
          </div>

          <div>
            <label className="block text-sm font-black text-gray-900 mb-2">Arbeidsbeskrivelse / Instrukser</label>
            <MarkdownEditor
              name="description"
              rows={4}
              defaultValue={workOrder.description || ""}
              placeholder="Beskriv hva som skal gjøres..."
            />
          </div>

          <div className="border-t-2 border-gray-200 pt-6">
            <button type="submit" className="w-full bg-blue-700 text-white py-4 rounded-xl font-black text-lg hover:bg-blue-800 transition shadow-md">
              💾 Lagre endringer
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}
