import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import CustomerSelect from "./CustomerSelect";
import { createWorkOrderSchema } from "./schemas";
import { z } from "zod";

export default async function AdminCreateWorkOrderPage() {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (user?.role !== "ADMIN" && user?.role !== "OFFICE") redirect("/");

  const customers = await prisma.customer.findMany({ orderBy: { name: 'asc' } });
  const templates = await prisma.template.findMany({ orderBy: { title: 'asc' } });
  const technicians = await prisma.user.findMany({ where: { role: { in: ['ADMIN', 'TECHNICIAN', 'OFFICE'] } } });

  async function createWorkOrder(formData: FormData): Promise<void> {
    "use server";

    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const customerId = formData.get("customerId") as string;
    const dateInput = formData.get("scheduledFor") as string;
    const scheduledFor = dateInput ? new Date(dateInput) : new Date();

    const technicianIds = formData.getAll("technicianIds") as string[];
    const templateIds = formData.getAll("templateIds") as string[];

    const parsed = createWorkOrderSchema.safeParse({
      title,
      description,
      customerId,
      scheduledFor: dateInput,
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
          customerId: customerId || undefined,
          scheduledFor,
          creatorName: user?.name || "Kontor",
          status: "PENDING",
          technicians: {
            connect: technicianIds.map(id => ({ id }))
          },
          templates: {
            connect: templateIds.map(id => ({ id }))
          }
        }
      });

      await prisma.auditLog.create({
        data: {
          entityType: "WorkOrder",
          entityId: newWo.id,
          action: `Kontoret opprettet nytt oppdrag: ${title}`,
          userName: user?.name || "Admin"
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

        <form action={createWorkOrder} className="bg-white p-6 rounded-2xl shadow-sm border space-y-5">
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

          <CustomerSelect customers={customers} optional={true} />

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Dato for utførelse</label>
            <input type="date" name="scheduledFor" defaultValue={new Date().toISOString().split("T")[0]} required className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium" />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Tildel montører</label>
            <div className="max-h-40 overflow-y-auto bg-gray-50 p-3 rounded-xl border space-y-2">
              {technicians.map(tech => (
                <label key={tech.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-200 p-1.5 rounded-lg transition">
                  <input type="checkbox" name="technicianIds" value={tech.id} className="w-4 h-4 text-blue-600 rounded" />
                  <span className="font-medium text-gray-800 text-sm">{tech.name}</span>
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
            <label className="block text-sm font-bold text-gray-700 mb-1">Beskrivelse / Instrukser</label>
            <textarea name="description" rows={3} placeholder="Skriv instruksjoner til montøren..." className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white font-medium"></textarea>
          </div>

          <button type="submit" className="w-full bg-[var(--primary-color)] text-white py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm">
            Lagre oppdrag
          </button>
        </form>
      </div>
    </div>
  );
}
