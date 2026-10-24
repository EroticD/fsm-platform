import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { DEFAULT_PAGE_SIZE, parsePage } from "@/lib/pagination";
import { addCustomer } from "./actions";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export default async function KunderPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string; q?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.view")) redirect("/");

  const t = await getTranslations("common");

  // Montører får lese kundekatalogen, men ikke registrere nye kunder.
  const office = hasPermission(user, "customers.manage");

  const resolved = await searchParams;
  const error = resolved.error;
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
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">{t("customers.list.title")}</h1>
          <Link href="/" className="text-blue-600 hover:underline font-medium">
            &larr; {t("customers.list.backToDashboard")}
          </Link>
        </div>

        {error === "ugyldig-data" && (
          <div className="bg-red-50 border-2 border-red-200 text-red-800 p-4 rounded-xl mb-4 text-sm font-bold">
            ⛔ {t("customers.list.errorInvalidData")}
          </div>
        )}

        {/* Skjema for å legge til ny kunde – kun kontor/admin */}
        {office && (
          <div className="bg-white p-6 rounded-xl shadow-sm border mb-8">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">{t("customers.list.addTitle")}</h2>
            <form action={addCustomer} className="flex flex-col sm:flex-row gap-4">
              <input
                type="text"
                name="name"
                placeholder={t("customers.list.namePlaceholder")}
                required
                className="border p-2 rounded flex-1 text-gray-800"
              />
              <input
                type="text"
                name="orgNumber"
                placeholder={t("customers.list.orgNumberPlaceholder")}
                className="border p-2 rounded flex-1 text-gray-800"
              />
              <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition font-medium whitespace-nowrap">
                {t("customers.list.save")}
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
              placeholder={t("customers.list.searchPlaceholder")}
              className="flex-1 min-w-[12rem] border p-2.5 rounded-xl text-sm text-gray-900"
            />
            <button type="submit" className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-800 transition">
              {t("customers.list.search")}
            </button>
            {search && (
              <Link href="/kunder" className="bg-gray-200 text-gray-700 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-300 transition">
                {t("customers.list.reset")}
              </Link>
            )}
          </form>
        </div>

        {/* Tabell med eksisterende kunder */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-4 font-semibold text-gray-600 border-b">{t("customers.list.companyName")}</th>
                <th className="p-4 font-semibold text-gray-600 border-b">{t("customers.list.orgNumber")}</th>
                <th className="p-4 font-semibold text-gray-600 border-b w-32">{t("customers.list.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-gray-500">
                    {search
                      ? t("customers.list.noMatches", { query: search })
                      : t("customers.list.empty")}
                  </td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-gray-50 transition border-b last:border-0">
                    <td className="p-4 font-medium text-gray-800">{customer.name}</td>
                    <td className="p-4 text-gray-600">{customer.orgNumber || "-"}</td>
                    <td className="p-4">
                      <Link href={`/kunder/${customer.id}`} className="text-blue-600 hover:underline text-sm font-medium block">{t("customers.list.viewDetails")}</Link>
                      {office && (
                        <Link href={`/kunder/${customer.id}/rediger`} className="text-gray-600 hover:underline text-sm font-medium">{t("customers.list.edit")}</Link>
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
                ← {t("customers.list.previous")}
              </Link>
            )}
            <span className="text-sm font-bold text-gray-600">{t("customers.list.pagination", { page, totalPages })}</span>
            {page < totalPages && (
              <Link href={linkFor(page + 1)} className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition">
                {t("customers.list.next")} →
              </Link>
            )}
          </div>
        )}

        <p className="text-center text-xs text-gray-500 mt-4">{t("customers.list.total", { total })}</p>

      </div>
    </div>
  );
}
