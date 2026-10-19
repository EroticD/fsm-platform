import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { performSearch } from "@/lib/search";

export default async function SearchResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (user?.role === "CUSTOMER") redirect("/kundeportal");

  const resolvedParams = await searchParams;
  const query = resolvedParams.q?.trim() || "";

  const results = await performSearch(query);

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Tilbake og søkefelt */}
        <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center">
          <Link href="/" className="bg-white border text-gray-700 px-4 py-3 rounded-xl font-bold hover:bg-gray-50 shadow-sm whitespace-nowrap">
            &larr; Hjem
          </Link>
          <form action="/sok" method="GET" className="flex-1 flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={query}
              className="w-full border p-3 rounded-xl shadow-sm text-gray-800 text-lg outline-none"
              required
            />
            <button type="submit" className="bg-blue-600 text-white px-6 rounded-xl font-bold hover:bg-blue-700 shadow-sm">
              Søk
            </button>
          </form>
        </div>

        {query.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 text-lg">Skriv inn noe i søkefeltet for å starte. 👆</p>
          </div>
        ) : (
          <div className="space-y-6">
            <h1 className="text-2xl font-bold text-gray-800">
              Søkeresultater for «{query}»{" "}
              <span className="text-gray-400 text-lg">({results.total} treff)</span>
            </h1>

            {results.total === 0 && (
              <div className="bg-yellow-50 p-6 rounded-xl border border-yellow-200 text-center">
                <p className="text-yellow-800 font-bold">Ingen treff!</p>
                <p className="text-yellow-700 text-sm mt-1">
                  Prøv kortere søkeord, annen rekkefølge, eller fjern mellomrom/store bokstaver.
                </p>
              </div>
            )}

            <div className="space-y-6">
              {results.groups.map((group) => (
                <div key={group.kind} className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h2 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">
                    {group.icon} {group.label} ({group.items.length})
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {group.items.map((item) => (
                      <Link
                        key={`${group.kind}-${item.id}`}
                        href={item.href}
                        className="block p-3 rounded-lg border hover:border-blue-400 hover:bg-blue-50 transition"
                      >
                        <p className="font-bold text-gray-800">{item.title}</p>
                        {item.subtitle && (
                          <p className="text-xs text-gray-500 mt-1">{item.subtitle}</p>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}