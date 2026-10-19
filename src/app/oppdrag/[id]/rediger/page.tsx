import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import MarkdownEditor from "@/components/MarkdownEditor";
import TagSelector from "@/components/TagSelector";
import { LIMITS, cleanMarkdown, cleanText } from "@/lib/sanitize";
import { parseDateOnly } from "@/lib/dates";
import { requireOffice } from "@/lib/session";

export default async function EditWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const resolvedParams = await params;
  const workOrderId = resolvedParams.id;

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (user?.role === "TECHNICIAN") redirect("/mine-oppdrag");

  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      customer: true,
      technicians: true,
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

  const customers = await prisma.customer.findMany({ orderBy: { name: 'asc' } });
  const technicians = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'TECHNICIAN', 'OFFICE'] } },
    orderBy: { name: 'asc' }
  });
  const contacts = await prisma.contact.findMany({ orderBy: { name: 'asc' } });
  const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });

  // --- SERVER ACTION: LAGRE ENDRINGER ---
  async function updateWorkOrder(formData: FormData) {
    "use server";
    // Autorisasjonen må ligge i handlingen, ikke bare i sidevisningen.
    if (!(await requireOffice())) return;

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

    // Bare kjente ansatte kan tildeles.
    const validTechnicianIds = technicianIds.filter(id => technicians.some(t => t.id === id));

    // Oppdater grunnleggende info og bytt ut tildelte montører
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        title,
        description,
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
        action: `Admin oppdaterte oppdraget: ${title}`,
        userName: user?.name || "Admin"
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
            <label className="block text-sm font-black text-gray-900 mb-2">Kunde <span className="text-red-500">*</span></label>
            <select 
              name="customerId" 
              defaultValue={workOrder.customerId || undefined}
              required 
              className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
            >
              {customers.map(c => (
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
              {customers.map(c => {
                const customerContacts = contacts.filter((k) => k.customerId === c.id);
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
              {technicians.map(t => (
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
                  </span>
                </label>
              ))}
              {technicians.length === 0 && (
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
