import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { DEFAULT_PAGE_SIZE, parsePage } from "@/lib/pagination";
import { searchNormalizedIds } from "@/lib/search-sql";
import { customerSearchOr } from "@/lib/customer-search";
import {
  addCustomer,
  deleteCustomerAction,
  restoreCustomerAction,
} from "./actions";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import SectionCard from "@/components/SectionCard";
import SubmitButton from "@/components/SubmitButton";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export default async function KunderPage({
  searchParams,
}: {
  searchParams: Promise<{
    side?: string;
    q?: string;
    error?: string;
    slettet?: string;
  }>;
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
  const showDeleted = resolved.slettet === "1" && user.role === "ADMIN";
  const deletedFilter = showDeleted ? { not: null } : null;

  // Aktive kunder søkes med den normaliserte SQL-hjelperen. Den matcher alle
  // feltene på kundekortet, også telefon/org.nr/kundenummer med tegnsetting,
  // og filtrerer bort slettede kunder. Slettede kunder (kun admin) har ingen
  // slik hjelper, så de får et direkte OR-filter over de samme feltene.
  const activeMatches = search && !showDeleted
    ? await searchNormalizedIds("Customer", search, 500)
    : null;

  const where = search
    ? showDeleted
      ? { deletedAt: deletedFilter, ...customerSearchOr(search) }
      : { deletedAt: null, id: { in: activeMatches?.map((hit) => hit.id) ?? [] } }
    : { deletedAt: deletedFilter };

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
    if (showDeleted) params.set("slettet", "1");
    if (p > 1) params.set("side", String(p));
    const qs = params.toString();
    return `/kunder${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">

        <PageHeader
          title={t("customers.list.title")}
          className="mb-8"
          actions={
            <>
              {user.role === "ADMIN" && (
                <Link
                  href={showDeleted ? "/kunder" : "/kunder?slettet=1"}
                  className="text-sm font-bold text-gray-700 bg-white border-2 border-gray-200 px-3 py-2 rounded-xl hover:bg-gray-100 transition"
                >
                  {showDeleted
                    ? t("customers.list.showActive")
                    : t("customers.list.showDeleted")}
                </Link>
              )}
              <Link href="/" className="text-blue-600 hover:underline font-medium">
                &larr; {t("customers.list.backToDashboard")}
              </Link>
            </>
          }
        />

        {showDeleted && (
          <div className="bg-amber-50 border-2 border-amber-200 text-amber-900 p-4 rounded-xl mb-4 text-sm font-bold">
            {t("customers.list.deletedTitle")}
          </div>
        )}

        {error === "ugyldig-data" && (
          <ErrorBanner
            message={`⛔ ${t("customers.list.errorInvalidData")}`}
            className="mb-4"
          />
        )}

        {/* Skjema for å legge til ny kunde – kun kontor/admin */}
        {office && !showDeleted && (
          <SectionCard title={t("customers.list.addTitle")} className="mb-8">
            <form action={addCustomer} className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <label htmlFor="customer-name" className="block text-xs font-bold text-gray-700 mb-1">
                  {t("customers.list.companyName")}
                </label>
                <input
                  id="customer-name"
                  type="text"
                  name="name"
                  placeholder={t("customers.list.namePlaceholder")}
                  required
                  aria-required="true"
                  className="w-full border p-2 rounded text-gray-800"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="customer-org-number" className="block text-xs font-bold text-gray-700 mb-1">
                  {t("customers.list.orgNumber")}
                </label>
                <input
                  id="customer-org-number"
                  type="text"
                  name="orgNumber"
                  placeholder={t("customers.list.orgNumberPlaceholder")}
                  className="w-full border p-2 rounded text-gray-800"
                />
              </div>
              <SubmitButton
                pendingLabel={t("customers.list.saving")}
                className="self-end bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition font-medium whitespace-nowrap"
              >
                {t("customers.list.save")}
              </SubmitButton>
            </form>
          </SectionCard>
        )}

        {/* Søk */}
        <SectionCard className="mb-4">
          <form method="GET" action="/kunder" className="flex flex-wrap gap-2">
            <input
              type="search"
              name="q"
              defaultValue={search}
              aria-label={t("customers.list.searchPlaceholder")}
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
        </SectionCard>

        {/* Tabell med eksisterende kunder. På mobil kan tabellen scrolles
            vannrett i stedet for å presse hele siden bredere enn skjermen. */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full min-w-[34rem] text-left border-collapse">
            <thead className="bg-gray-100">
              <tr>
                <th scope="col" className="p-4 font-semibold text-gray-600 border-b">{t("customers.list.companyName")}</th>
                <th scope="col" className="p-4 font-semibold text-gray-600 border-b">{t("customers.list.orgNumber")}</th>
                <th scope="col" className="p-4 font-semibold text-gray-600 border-b w-32">{t("customers.list.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-4">
                    <EmptyState
                      icon="🏢"
                      title={
                        search
                          ? t("customers.list.noMatches", { query: search })
                          : t("customers.list.empty")
                      }
                    />
                  </td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-gray-50 transition border-b last:border-0">
                    <td className="p-4 font-medium text-gray-800">{customer.name}</td>
                    <td className="p-4 text-gray-600">{customer.orgNumber || "-"}</td>
                    <td className="p-4 space-y-1">
                      {showDeleted ? (
                        <form action={restoreCustomerAction}>
                          <input type="hidden" name="id" value={customer.id} />
                          <button
                            type="submit"
                            className="text-emerald-700 hover:underline text-sm font-bold"
                          >
                            {t("customers.list.restore")}
                          </button>
                        </form>
                      ) : (
                        <>
                          <Link href={`/kunder/${customer.id}`} className="text-blue-600 hover:underline text-sm font-medium block">{t("customers.list.viewDetails")}</Link>
                          {office && (
                            <Link href={`/kunder/${customer.id}/rediger`} className="text-gray-600 hover:underline text-sm font-medium">{t("customers.list.edit")}</Link>
                          )}
                          {user.role === "ADMIN" && (
                            <ConfirmSubmitForm
                              action={deleteCustomerAction}
                              confirmMessage={t("customers.list.deleteConfirm", {
                                name: customer.name,
                              })}
                              confirmLabel={t("delete")}
                              danger
                            >
                              <input type="hidden" name="id" value={customer.id} />
                              <button
                                type="submit"
                                className="text-red-600 hover:underline text-sm font-medium"
                              >
                                {t("customers.list.delete")}
                              </button>
                            </ConfirmSubmitForm>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
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
