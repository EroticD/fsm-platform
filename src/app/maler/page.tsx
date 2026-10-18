import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { isOffice, requireOffice } from "@/lib/session";

export default async function MalerPage() {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  // Sjekklistemaler er kontorets verktøy – montørene får dem servert i skjemaet.
  if (!isOffice(user?.role)) redirect("/");
  
  const templates = await prisma.template.findMany({ orderBy: { title: 'asc' } });

  async function createTemplate(formData: FormData) {
    "use server";
    if (!(await requireOffice())) return;
    const title = cleanText(formData.get("title"), { maxLength: LIMITS.title });
    if (title) {
      await prisma.template.create({
        data: {
          title,
          fieldsJson: JSON.stringify(["Visuell sjekk", "Funksjonstest", "Rengjøring utført"])
        }
      });
      revalidatePath("/maler");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <div className="flex justify-between items-center border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">Sjekklistemaler</h1>
            <p className="text-gray-500 mt-1">Administrer malene som montørene bruker ute på oppdrag.</p>
          </div>
          <Link href="/" className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium hover:bg-gray-300 transition">
            &larr; Tilbake til Hjem
          </Link>
        </div>

        {/* Opprett ny mal */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border">
          <h2 className="font-bold text-gray-800 text-lg mb-4">Opprett ny sjekklistemal</h2>
          <form action={createTemplate} className="flex gap-3">
            <input type="text" name="title" placeholder="Malens navn (f.eks. Årlig service ventilasjon)..." required className="border p-3 rounded-xl text-gray-800 flex-1" />
            <button type="submit" className="bg-blue-600 text-white px-6 rounded-xl font-bold hover:bg-blue-700 transition shadow-sm">
              Opprett mal
            </button>
          </form>
        </div>

        {/* Liste over maler */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border space-y-4">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Eksisterende maler ({templates.length})</h2>
          
          {templates.length === 0 ? (
            <p className="text-gray-500 italic">Ingen maler opprettet enda.</p>
          ) : (
            <div className="space-y-3">
              {templates.map(t => {
                let fields: string[] = [];
                try {
                  const parsed = JSON.parse(t.fieldsJson);
                  if (Array.isArray(parsed)) {
                    fields = parsed;
                  }
                } catch (e) {
                  fields = [];
                }

                return (
                  <div key={t.id} className="p-4 rounded-xl border bg-gray-50 flex justify-between items-center hover:shadow-sm transition">
                    <div>
                      <h3 className="font-bold text-gray-800 text-lg">{t.title}</h3>
                      <p className="text-xs text-gray-500 mt-1">
                        {fields.length} sjekkpunkter: {fields.slice(0, 3).join(", ")} {fields.length > 3 ? "..." : ""}
                      </p>
                    </div>
                    <Link href={`/maler/${t.id}`} className="bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-800 transition shadow-sm">
                      Rediger mal ✏️
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
