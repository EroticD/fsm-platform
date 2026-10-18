import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";

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
      templates: true
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
  const technicians = await prisma.user.findMany({ orderBy: { name: 'asc' } });

  // --- SERVER ACTION: LAGRE ENDRINGER ---
  async function updateWorkOrder(formData: FormData) {
    "use server";
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const customerId = formData.get("customerId") as string;
    const scheduledFor = formData.get("scheduledFor") as string;
    const technicianId = formData.get("technicianId") as string;

    if (!title || !customerId) return;

    // Oppdater grunnleggende info og oppdater tildelt montør
    await prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        title,
        description,
        customerId,
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
        technicians: technicianId ? { set: [{ id: technicianId }] } : { set: [] }
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <label className="block text-sm font-black text-gray-900 mb-2">Primær montør</label>
              <select 
                name="technicianId" 
                defaultValue={workOrder.technicians[0]?.id || ""}
                className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
              >
                <option value="">-- Ingen tildelt --</option>
                {technicians.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.role})</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-black text-gray-900 mb-2">Arbeidsbeskrivelse / Instrukser</label>
            <textarea 
              name="description" 
              rows={4}
              defaultValue={workOrder.description || ""}
              className="w-full border-2 border-gray-300 p-3.5 rounded-xl text-base font-bold text-gray-900 bg-white outline-none focus:border-blue-700"
              placeholder="Beskriv hva som skal gjøres..."
            ></textarea>
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
