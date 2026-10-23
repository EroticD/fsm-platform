import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import CustomerSelect from "./CustomerSelect";
import MarkdownEditor from "@/components/MarkdownEditor";
import TagSelector from "@/components/TagSelector";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getActiveDepartments, getDefaultDepartmentId } from "@/lib/departments";
import { staffForDepartment, staffWhere } from "@/lib/access";
import { createWorkOrder } from "./actions";

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

  // Skjemaet trenger bare et avgrenset utvalg; søk i listen dekker resten.
  const customers = await prisma.customer.findMany({
    orderBy: { name: 'asc' },
    take: 100,
    select: { id: true, name: true, city: true, customerNumber: true },
  });
  const contacts = await prisma.contact.findMany({
    orderBy: { name: 'asc' },
    take: 200,
    select: { id: true, name: true, role: true, customerId: true },
  });
  const templates = await prisma.template.findMany({ orderBy: { title: 'asc' } });
  const technicians = await prisma.user.findMany({
    where: isAdmin ? staffWhere() : staffForDepartment(ownDepartmentId),
    include: { department: true },
    orderBy: { name: "asc" },
    take: 100,
  });
  const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });

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

        {error === "ugyldig-data" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 rounded-2xl px-5 py-4 text-sm font-bold">
            ⛔ Oppdraget kunne ikke lagres. Sjekk tittel, dato og avdeling.
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
