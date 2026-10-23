import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getCurrentUser, requirePermission } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import MarkdownEditor from "@/components/MarkdownEditor";
import { LIMITS, cleanEmail, cleanMarkdown, cleanPhone, cleanText } from "@/lib/sanitize";

export default async function EditCustomerPage({ 
  params 
}: { 
  params: Promise<{ id: string }> 
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/api/auth/signin");

  const resolvedParams = await params;
  const customerId = resolvedParams.id;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  // Å redigere kundedata krever customers.manage. Montører får lese kundekortet.
  if (!hasPermission(session, "customers.manage")) redirect(`/kunder/${customerId}`);

  const departments = await prisma.department.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });
  const technicians = await prisma.user.findMany({
    where: { isActive: true, role: { in: ["ADMIN", "OFFICE", "TECHNICIAN"] } },
    orderBy: { name: "asc" },
    take: 100,
  });

  // Den ansvarlige montøren må være med i listen selv om vedkommende faller
  // utenfor det avgrensede utvalget.
  const technicianOptions = [...technicians];
  if (
    customer?.responsibleTechnicianId &&
    !technicianOptions.some((technician) => technician.id === customer.responsibleTechnicianId)
  ) {
    const currentTechnician = await prisma.user.findUnique({
      where: { id: customer.responsibleTechnicianId },
    });
    if (currentTechnician) technicianOptions.unshift(currentTechnician);
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Kunden finnes ikke</h1>
        <Link href="/kunder" className="text-blue-600 font-bold hover:underline">
          Gå tilbake til kundearkivet
        </Link>
      </div>
    );
  }

  // --- SERVER ACTION: OPPRETT KUNDE ---
  async function updateCustomer(formData: FormData) {
    "use server";
    if (!(await requirePermission("customers.manage"))) return;
    const actor = await getCurrentUser();
    if (!actor) return;

    const name = cleanText(formData.get("name"), { maxLength: LIMITS.title });
    const customerNumber = cleanText(formData.get("customerNumber"), { maxLength: LIMITS.line });
    const orgNumber = cleanText(formData.get("orgNumber"), { maxLength: LIMITS.line });
    const brandColor = cleanText(formData.get("brandColor"), { maxLength: 20 });
    const address = cleanText(formData.get("address"), { maxLength: LIMITS.line });
    const postalCode = cleanText(formData.get("postalCode"), { maxLength: 20 });
    const city = cleanText(formData.get("city"), { maxLength: LIMITS.short });
    const phone = cleanPhone(formData.get("phone"));
    const email = cleanEmail(formData.get("email"));
    const notes = cleanMarkdown(formData.get("notes"));
    const departmentId = cleanText(formData.get("departmentId"), { maxLength: LIMITS.line });
    const responsibleTechnicianId = cleanText(formData.get("responsibleTechnicianId"), { maxLength: LIMITS.line });

    if (!name) return;

    try {
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          name,
          customerNumber: customerNumber || null,
          orgNumber: orgNumber || null,
          brandColor: brandColor || "#2563eb",
          address: address || null,
          postalCode: postalCode || null,
          city: city || null,
          phone: phone || null,
          email: email || null,
          notes: notes || null,
          departmentId: departmentId || null,
          responsibleTechnicianId: responsibleTechnicianId || null,
        },
      });
      await prisma.auditLog.create({
        data: {
          entityType: "Customer",
          entityId: customerId,
          action: `Endret kundeinformasjon: ${name}`,
          userName: actor.name || actor.email || "Ukjent"
        }
      });
      revalidatePath(`/kunder/${customerId}`);
      revalidatePath("/kunder");
    } catch (error) {
      console.error("Feil ved oppdatering av kunde:", error);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="flex justify-between items-center border-b pb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">✏️ Rediger kunde</h1>
            <p className="text-gray-500 mt-1 text-sm">Endre kundeinformasjon for {customer.name}.</p>
          </div>
          <div className="flex gap-3">
            <Link href={`/kunder/${customerId}`} className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition shadow-sm">
              &larr; Tilbake til detaljer
            </Link>
            <Link href="/kunder" className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition shadow-sm">
              Kundearkiv
            </Link>
          </div>
        </div>

        <form action={updateCustomer} className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border border-gray-100 space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Firmanavn */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Firmanavn *</label>
              <input 
                type="text" 
                name="name" 
                defaultValue={customer.name} 
                required 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"
              />
            </div>

            {/* Kundenummer */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Kundenummer (valgfritt)</label>
              <input 
                type="text" 
                name="customerNumber" 
                defaultValue={customer.customerNumber || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

            {/* Org.nr */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Org.nr (valgfritt)</label>
              <input 
                type="text" 
                name="orgNumber" 
                defaultValue={customer.orgNumber || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

            {/* Merkevarefarge */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Merkevarefarge</label>
              <div className="flex gap-3 items-center">
                <input 
                  type="color" 
                  name="brandColor" 
                  defaultValue={customer.brandColor || "#2563eb"} 
                  className="w-12 h-12 p-1 rounded cursor-pointer border border-gray-300"
                />
                <input 
                  type="text" 
                  name="brandColorText" 
                  defaultValue={customer.brandColor || "#2563eb"} 
                  className="flex-1 border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium bg-gray-50" 
                  readOnly 
                />
              </div>
            </div>

          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Adresse */}
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-700 mb-1">Adresse (valgfritt)</label>
              <input 
                type="text" 
                name="address" 
                defaultValue={customer.address || ""} 
                placeholder="Gateadresse" 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Postnr */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Postnummer (valgfritt)</label>
              <input 
                type="text" 
                name="postalCode" 
                defaultValue={customer.postalCode || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

            {/* By */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">By (valgfritt)</label>
              <input 
                type="text" 
                name="city" 
                defaultValue={customer.city || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

            {/* Telefon */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Telefon (valgfritt)</label>
              <input 
                type="tel" 
                name="phone" 
                defaultValue={customer.phone || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

            {/* E-post */}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">E-post (valgfritt)</label>
              <input 
                type="email" 
                name="email" 
                defaultValue={customer.email || ""} 
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white"
              />
            </div>

          </div>

          {/* Avdeling og ansvarlig montør */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Tilhørende avdeling (valgfritt)</label>
              <select
                name="departmentId"
                defaultValue={customer.departmentId || ""}
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"
              >
                <option value="">— Ingen avdeling —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Brukes i kundeportalen for å vise riktig avdelingsinformasjon.</p>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Ansvarlig montør (valgfritt)</label>
              <select
                name="responsibleTechnicianId"
                defaultValue={customer.responsibleTechnicianId || ""}
                className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"
              >
                <option value="">— Ingen ansvarlig —</option>
                {technicianOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.name || t.email}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Vises som direkte kontakt i kundeportalen.</p>
            </div>
          </div>

          {/* Noter */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Noter (valgfritt)</label>
            <MarkdownEditor
              name="notes"
              rows={4}
              defaultValue={customer.notes || ""}
              placeholder="Noter om kunden..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Link href={`/kunder/${customerId}`} className="bg-gray-100 text-gray-700 px-6 py-3 rounded-xl font-bold hover:bg-gray-200 transition shadow-sm">
              Avbryt
            </Link>
            <button type="submit" className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition shadow-sm">
              Lagre endringer
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
