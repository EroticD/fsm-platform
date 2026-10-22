import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { getCurrentUser, requirePermission } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { DEFAULT_PAGE_SIZE, parsePage } from "@/lib/pagination";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export default async function KunderPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.view")) redirect("/");

  // Montører får lese kundekatalogen, men ikke registrere nye kunder.
  const office = hasPermission(user, "customers.manage");

  const resolved = await searchParams;
  const search = resolved.q?.trim() || "";
  const page = parsePage(resolved.side);

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { orgNumber: { contains: search, mode: "insensitive" as const } },
          { city: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { name: "asc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    prisma.customer.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Dette er en "Server Action" som kjører trygt på serveren når skjemaet sendes inn
  async function addCustomer(formData: FormData) {
    "use server";
    if (!(await requirePermission("customers.manage"))) return;

    const name = cleanText(formData.get("name"), { maxLength: LIMITS.title });
    const orgNumber = cleanText(formData.get("orgNumber"), { maxLength: LIMITS.line });

    if (name) {
      // Lagrer i databasen
      await prisma.customer.create({
        data: { name, orgNumber: orgNumber || null },
      });
      // Oppdaterer siden umiddelbart slik at den nye kunden vises
      revalidatePath("/kunder");
    }
  }

  const linkFor = (p: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (p > 1) params.set("side", String(p));
    const qs = params.toString();
    return `/kunder${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">

        {/* Navigasjon på toppen */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Kundekatalog</h1>
          <Link href="/" className="text-blue-600 hover:underline font-medium">
            &larr; Tilbake til Dashbord
          </Link>
        </div>

        {/* Skjema for å legge til ny kunde – kun kontor/admin */}
        {office && (
          <div className="bg-white p-6 rounded-xl shadow-sm border mb-8">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">Registrer ny kunde</h2>
            <form action={addCustomer} className="flex flex-col sm:flex-row gap-4">
              <input
                type="text"
                name="name"
                placeholder="Firmanavn"
                required
                className="border p-2 rounded flex-1 text-gray-800"
              />
              <input
                type="text"
                name="orgNumber"
                placeholder="Org.nummer (valgfritt)"
                className="border p-2 rounded flex-1 text-gray-800"
              />
              <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition font-medium whitespace-nowrap">
                Lagre kunde
              </button>
            </form>
          </div>
        )}

        {/* Søk */}
        <div className="bg-white p-4 rounded-xl shadow-sm border mb-4">
          <form method="GET" action="/kunder" className="flex flex-wrap gap-2">
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Søk på navn, org.nr, sted eller e-post..."
              className="flex-1 min-w-[12rem] border p-2.5 rounded-xl text-sm text-gray-900"
            />
            <button type="submit" className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition">
              Søk
            </button>
            {search && (
              <Link href="/kunder" className="bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-300 transition">
                Nullstill
              </Link>
            )}
          </form>
        </div>

        {/* Tabell med eksisterende kunder */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-4 font-semibold text-gray-600 border-b">Firmanavn</th>
                <th className="p-4 font-semibold text-gray-600 border-b">Org.nummer</th>
                <th className="p-4 font-semibold text-gray-600 border-b w-32">Handling</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-gray-500">
                    {search
                      ? `Ingen kunder matcher «${search}».`
                      : "Ingen kunder registrert enda. Legg til din første kunde over!"}
                  </td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-gray-50 transition border-b last:border-0">
                    <td className="p-4 font-medium text-gray-800">{customer.name}</td>
                    <td className="p-4 text-gray-600">{customer.orgNumber || "-"}</td>
                    <td className="p-4">
                      <Link href={`/kunder/${customer.id}`} className="text-blue-600 hover:underline text-sm font-medium block">Se detaljer</Link>
                      {office && (
                        <Link href={`/kunder/${customer.id}/rediger`} className="text-gray-600 hover:underline text-sm font-medium">Rediger</Link>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Sidebladdring */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-4">
            {page > 1 && (
              <Link href={linkFor(page - 1)} className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition">
                ← Forrige
              </Link>
            )}
            <span className="text-sm font-bold text-gray-600">Side {page} av {totalPages}</span>
            {page < totalPages && (
              <Link href={linkFor(page + 1)} className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition">
                Neste →
              </Link>
            )}
          </div>
        )}

        <p className="text-center text-xs text-gray-500 mt-4">{total} kunde(r)</p>

      </div>
    </div>
  );
}
