import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (user?.role !== "ADMIN") redirect("/");

  const resolvedParams = await params;
  const templateId = resolvedParams.id;

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) return <div className="p-8">Mal ikke funnet</div>;

  // Henter feltene. Støtter både gammel liste (array av strings) og ny avansert struktur (array av objekter)
  let fields: any[] = [];
  try {
    const parsed = JSON.parse(template.fieldsJson || "[]");
    if (Array.isArray(parsed)) {
      fields = parsed.map(f => typeof f === 'string' ? { label: f, requirePhoto: false, requireComment: false } : f);
    }
  } catch (e) {
    fields = [];
  }

  async function updateTitle(formData: FormData) {
    "use server";
    const title = formData.get("title") as string;
    if (title) {
      await prisma.template.update({ where: { id: templateId }, data: { title } });
      revalidatePath(`/maler/${templateId}`);
    }
  }

  async function addField(formData: FormData) {
    "use server";
    const label = formData.get("label") as string;
    const requirePhoto = formData.get("requirePhoto") === "on";
    const requireComment = formData.get("requireComment") === "on";

    if (label && label.trim() !== "") {
      const newFieldObj = { label: label.trim(), requirePhoto, requireComment };
      const updatedFields = [...fields, newFieldObj];
      await prisma.template.update({
        where: { id: templateId },
        data: { fieldsJson: JSON.stringify(updatedFields) }
      });
      revalidatePath(`/maler/${templateId}`);
    }
  }

  async function removeField(formData: FormData) {
    "use server";
    const indexToRemove = parseInt(formData.get("index") as string, 10);
    const updatedFields = fields.filter((_, idx) => idx !== indexToRemove);
    await prisma.template.update({
      where: { id: templateId },
      data: { fieldsJson: JSON.stringify(updatedFields) }
    });
    revalidatePath(`/maler/${templateId}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        
        <div className="flex justify-between items-center border-b pb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Rediger Sjekklistemal</h1>
            <p className="text-gray-500 text-sm">Sett opp punkter, bildekrav og kommentarer for feltenhetene.</p>
          </div>
          <Link href="/maler" className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-300 transition text-sm">
            &larr; Tilbake til maler
          </Link>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border">
          <h2 className="font-bold text-gray-800 mb-3 text-sm uppercase tracking-wide">Navn på mal</h2>
          <form action={updateTitle} className="flex gap-2">
            <input type="text" name="title" defaultValue={template.title} required className="border p-3 rounded-xl text-gray-800 flex-1 font-medium" />
            <button type="submit" className="bg-gray-900 text-white px-5 rounded-xl font-bold text-sm hover:bg-gray-800 transition">Lagre navn</button>
          </form>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-4">
          <h2 className="font-bold text-gray-800 text-sm uppercase tracking-wide">Sjekkpunkter & Krav ({fields.length})</h2>
          
          {fields.length === 0 ? (
            <div className="bg-gray-50 p-6 rounded-xl border border-dashed text-center">
              <p className="text-gray-500 text-sm italic">Ingen punkter i denne malen enda.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {fields.map((f, idx) => (
                <div key={idx} className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border">
                  <div>
                    <p className="font-bold text-gray-800">🔹 {f.label}</p>
                    <div className="flex gap-2 mt-1">
                      {f.requirePhoto && <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold">📷 Krever bilde</span>}
                      {f.requireComment && <span className="text-[10px] bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded font-bold">💬 Krever kommentar</span>}
                    </div>
                  </div>
                  <form action={removeField}>
                    <input type="hidden" name="index" value={idx} />
                    <button type="submit" className="text-red-500 hover:text-red-700 text-xs font-bold bg-white px-3 py-1.5 rounded-lg border border-red-100 shadow-sm transition">
                      Slett
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}

          {/* Skjema for å legge til nytt punkt med bilde-/kommentarkrav */}
          <form action={addField} className="bg-gray-50 p-4 rounded-xl border space-y-3 pt-4 mt-4">
            <p className="font-bold text-gray-700 text-xs uppercase tracking-wide">Legg til nytt sjekkpunkt</p>
            <input type="text" name="label" placeholder="Beskrivelse av punkt (f.eks. Kontroller reimspenning)..." required className="w-full border p-3 rounded-xl text-gray-800 text-sm bg-white" />
            
            <div className="flex gap-6 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input type="checkbox" name="requirePhoto" className="w-4 h-4 text-blue-600 rounded" />
                <span>Krev bildebevis ved avvik / utført</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input type="checkbox" name="requireComment" className="w-4 h-4 text-blue-600 rounded" />
                <span>Krev tekstkommentar</span>
              </label>
            </div>

            <button type="submit" className="w-full bg-blue-600 text-white p-3 rounded-xl font-bold text-sm hover:bg-blue-700 transition shadow-sm mt-2">
              + Legg til punkt i malen
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
