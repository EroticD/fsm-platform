import { redirect } from "next/navigation";
import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { getLocale, getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { DEFAULT_PAGE_SIZE, parsePage } from "@/lib/pagination";
import { searchNormalizedIds } from "@/lib/search-sql";
import { customerSearchOr } from "@/lib/customer-search";
import { formatDateLocalized } from "@/lib/dates";
import { workOrderScopeFor } from "@/server/actor";
import { CUSTOMER_ACTIVE_STATUSES } from "@/server/customers";
import {
  addCustomer,
  deleteCustomerAction,
  restoreCustomerAction,
} from "./actions";
import {
  customerErrorMessageKey,
  customerStatusMessageKey,
} from "./feedback";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import CustomerToast from "@/components/customer/CustomerToast";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import Pagination, { paginationLabels } from "@/components/Pagination";
import SectionCard from "@/components/SectionCard";
import SubmitButton from "@/components/SubmitButton";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

type SortKey = "name" | "city" | "orgNumber";

function isSortKey(value: string | undefined): value is SortKey {
  return value === "name" || value === "city" || value === "orgNumber";
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("metadata.routes.kunder") };
}

export default async function KunderPage({
  searchParams,
}: {
  searchParams: Promise<{
    side?: string;
    q?: string;
    error?: string;
    status?: string;
    slettet?: string;
    sort?: string;
    dir?: string;
    varsel?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.view")) redirect("/");

  const t = await getTranslations("common");
  const locale = await getLocale();

  // Montører får lese kundekatalogen, men ikke registrere nye kunder.
  const office = hasPermission(user, "customers.manage");

  const resolved = await searchParams;
  const {
    error,
    status,
    varsel,
    q,
    side,
    slettet,
    sort: rawSort,
    dir: rawDir,
  } = resolved;
  const search = q?.trim() || "";
  const requestedPage = parsePage(side);
  const showDeleted = slettet === "1" && user.role === "ADMIN";
  const deletedFilter = showDeleted ? { not: null } : null;

  const sortKey: SortKey = isSortKey(rawSort) ? rawSort : "name";
  const sortDir: Prisma.SortOrder = rawDir === "desc" ? "desc" : "asc";

  const statusKey = customerStatusMessageKey(status);
  const errorKey = customerErrorMessageKey(error);

  // Aktive kunder søkes med den normaliserte SQL-hjelperen. Den matcher alle
  // feltene på kundekortet, også telefon/org.nr/kundenummer med tegnsetting,
  // og filtrerer bort slettede kunder. Slettede kunder (kun admin) har ingen
  // slik hjelper, så de får et direkte OR-filter over de samme feltene.
  const activeMatches = search && !showDeleted
    ? await searchNormalizedIds("Customer", search, 500)
    : null;

  const where: Prisma.CustomerWhereInput = search
    ? showDeleted
      ? ({ deletedAt: deletedFilter, ...customerSearchOr(search) } as Prisma.CustomerWhereInput)
      : { deletedAt: null, id: { in: activeMatches?.map((hit) => hit.id) ?? [] } }
    : { deletedAt: deletedFilter };

  const orderBy: Prisma.CustomerOrderByWithRelationInput[] =
    sortKey === "city"
      ? [{ city: { sort: sortDir, nulls: "last" } }, { name: "asc" }]
      : sortKey === "orgNumber"
        ? [{ orgNumber: { sort: sortDir, nulls: "last" } }, { name: "asc" }]
        : [{ name: sortDir }];

  // Oppdragstellingen følger samme avdelingssperre som resten av kundekortet.
  // Da viser ikke listen åpne oppdrag fra avdelinger brukeren ikke ser.
  const orderScope = workOrderScopeFor(user);

  // Tell først, slik at en gammel `?side=999` klemmes til en side som finnes
  // før listen hentes. Ellers ville brukeren fått en tom side uten treff.
  const total = await prisma.customer.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const customers = await prisma.customer.findMany({
    where,
    orderBy,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
    select: {
      id: true,
      name: true,
      orgNumber: true,
      city: true,
      phone: true,
      contacts: {
        orderBy: { name: "asc" },
        take: 1,
        select: { name: true, phone: true },
      },
      _count: {
        select: {
          workOrder: {
            where: {
              AND: [
                orderScope,
                { status: { in: CUSTOMER_ACTIVE_STATUSES } },
              ],
            },
          },
        },
      },
      workOrder: {
        where: {
          AND: [orderScope, { status: "COMPLETED" }],
        },
        orderBy: [{ scheduledFor: "desc" }, { updatedAt: "desc" }],
        take: 1,
        select: { scheduledFor: true, updatedAt: true },
      },
    },
  });

  const linkFor = (p: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (showDeleted) params.set("slettet", "1");
    if (sortKey !== "name") params.set("sort", sortKey);
    if (sortDir !== "asc") params.set("dir", sortDir);
    if (p > 1) params.set("side", String(p));
    const qs = params.toString();
    return `/kunder${qs ? `?${qs}` : ""}`;
  };

  const sortHref = (key: SortKey) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (showDeleted) params.set("slettet", "1");
    const nextDir = sortKey === key && sortDir === "asc" ? "desc" : "asc";
    params.set("sort", key);
    if (nextDir !== "asc") params.set("dir", nextDir);
    return `/kunder?${params.toString()}`;
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };

  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" => {
    if (sortKey !== key) return "none";
    return sortDir === "asc" ? "ascending" : "descending";
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">

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

        {statusKey && <CustomerToast message={t(statusKey)} tone="success" />}

        <ErrorBanner
          message={errorKey ? `⛔ ${t(errorKey)}` : undefined}
          className="mb-4"
        />

        {varsel === "enheter" && (
          <div className="mb-4 rounded-xl border-2 border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-900">
            🔧 {t("customers.list.unitsNotice")}
          </div>
        )}

        {showDeleted && (
          <div className="bg-amber-50 border-2 border-amber-200 text-amber-900 p-4 rounded-xl mb-4 text-sm font-bold">
            {t("customers.list.deletedTitle")}
          </div>
        )}

        {/* Skjema for å legge til ny kunde – kun kontor/admin, sammenlagt som
            standard slik at kundelisten er det første brukeren ser. */}
        {office && !showDeleted && (
          <details className="mb-8 rounded-2xl border-2 border-gray-200 bg-white shadow-sm">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-black text-blue-700 hover:bg-blue-50/60 sm:px-6">
              ➕ {t("customers.list.newCustomer")}
            </summary>
            <div className="border-t-2 border-gray-100 p-4 sm:p-6">
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
            </div>
          </details>
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
            {showDeleted && <input type="hidden" name="slettet" value="1" />}
            {sortKey !== "name" && <input type="hidden" name="sort" value={sortKey} />}
            {sortDir !== "asc" && <input type="hidden" name="dir" value={sortDir} />}
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
            vannrett i stedet for å presse hele siden bredere enn skjermen.
            Hele raden er klikkbar via en dekkende lenke; handlingene løftes
            over lenken slik at de fortsatt kan brukes. */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div
            className="hidden overflow-x-auto sm:block"
            role="region"
            aria-label={t("customers.list.title")}
            tabIndex={0}
          >
          <table className="w-full min-w-[56rem] text-left border-collapse">
            <caption className="sr-only">{t("customers.list.title")}</caption>
            <thead className="bg-gray-100">
              <tr>
                <th scope="col" aria-sort={ariaSort("name")} className="p-4 font-semibold text-gray-600 border-b">
                  <Link href={sortHref("name")} aria-label={t("customers.list.sortBy", { column: t("customers.list.companyName") })} className="inline-flex items-center gap-1 hover:text-gray-900">
                    {t("customers.list.companyName")} <span aria-hidden="true">{sortIndicator("name")}</span>
                  </Link>
                </th>
                <th scope="col" aria-sort={ariaSort("city")} className="p-4 font-semibold text-gray-600 border-b">
                  <Link href={sortHref("city")} aria-label={t("customers.list.sortBy", { column: t("customers.list.city") })} className="inline-flex items-center gap-1 hover:text-gray-900">
                    {t("customers.list.city")} <span aria-hidden="true">{sortIndicator("city")}</span>
                  </Link>
                </th>
                <th scope="col" className="p-4 font-semibold text-gray-600 border-b">{t("customers.list.contact")}</th>
                <th scope="col" aria-sort={ariaSort("orgNumber")} className="p-4 font-semibold text-gray-600 border-b">
                  <Link href={sortHref("orgNumber")} aria-label={t("customers.list.sortBy", { column: t("customers.list.orgNumber") })} className="inline-flex items-center gap-1 hover:text-gray-900">
                    {t("customers.list.orgNumber")} <span aria-hidden="true">{sortIndicator("orgNumber")}</span>
                  </Link>
                </th>
                <th scope="col" className="p-4 font-semibold text-gray-600 border-b">{t("customers.list.openOrders")}</th>
                <th scope="col" className="p-4 font-semibold text-gray-600 border-b">{t("customers.list.lastService")}</th>
                <th scope="col" className="p-4 font-semibold text-gray-600 border-b w-32">{t("customers.list.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-4">
                    <EmptyState
                      icon="🏢"
                      title={
                        search
                          ? t("customers.list.noMatches", { query: search })
                          : t("customers.list.empty")
                      }
                      action={
                        search ? (
                          <Link
                            href={showDeleted ? "/kunder?slettet=1" : "/kunder"}
                            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
                          >
                            {t("customers.list.reset")}
                          </Link>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                customers.map((customer) => {
                  const contact = customer.contacts[0] ?? null;
                  const lastService = customer.workOrder[0];
                  const lastServiceDate =
                    lastService?.scheduledFor ?? lastService?.updatedAt ?? null;

                  return (
                    <tr key={customer.id} className="group relative hover:bg-gray-50 transition border-b last:border-0">
                      <td className="p-4 font-medium text-gray-800">
                        <Link
                          href={`/kunder/${customer.id}`}
                          aria-label={t("customers.list.openCustomer", {
                            name: customer.name,
                          })}
                          className="absolute inset-0 z-0"
                        />
                        <span className="relative z-10">{customer.name}</span>
                      </td>
                      <td className="p-4 text-gray-600">{customer.city || "–"}</td>
                      <td className="p-4 text-gray-600">
                        {contact ? (
                          <>
                            <span className="block font-medium text-gray-800">{contact.name}</span>
                            <span className="block text-xs">
                              {contact.phone || customer.phone || "–"}
                            </span>
                          </>
                        ) : (
                          <span>{customer.phone || t("customers.list.noContact")}</span>
                        )}
                      </td>
                      <td className="p-4 text-gray-600">{customer.orgNumber || "–"}</td>
                      <td className="p-4 text-gray-700 font-bold">
                        {customer._count.workOrder}
                      </td>
                      <td className="p-4 text-gray-600">
                        {formatDateLocalized(
                          lastServiceDate,
                          locale,
                          undefined,
                          t("customers.list.neverServiced"),
                        )}
                      </td>
                      <td className="relative z-10 p-4 space-y-1">
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
                  );
                })
              )}
            </tbody>
          </table>
          </div>

          {/* Under sm blir tabellen en kortliste, slik at kundenavn, kontakt
              og handlinger ikke krever vannrett scrolling på mobil. */}
          {customers.length === 0 ? (
            <div className="p-4 sm:hidden">
              <EmptyState
                icon="🏢"
                title={
                  search
                    ? t("customers.list.noMatches", { query: search })
                    : t("customers.list.empty")
                }
                action={
                  search ? (
                    <Link
                      href={showDeleted ? "/kunder?slettet=1" : "/kunder"}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
                    >
                      {t("customers.list.reset")}
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 sm:hidden">
              {customers.map((customer) => {
                const contact = customer.contacts[0] ?? null;
                const lastService = customer.workOrder[0];
                const lastServiceDate =
                  lastService?.scheduledFor ?? lastService?.updatedAt ?? null;

                return (
                  <li key={customer.id} className="space-y-3 p-4">
                    <div className="min-w-0">
                      <Link
                        href={`/kunder/${customer.id}`}
                        className="break-words text-base font-bold text-blue-800 hover:underline"
                      >
                        {customer.name}
                      </Link>
                      <p className="mt-0.5 break-words text-xs text-gray-600">
                        {customer.orgNumber || "–"}
                      </p>
                    </div>

                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                      <div className="min-w-0">
                        <dt className="text-2xs font-bold uppercase tracking-wide text-gray-500">
                          {t("customers.list.city")}
                        </dt>
                        <dd className="break-words text-gray-700">
                          {customer.city || "–"}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-2xs font-bold uppercase tracking-wide text-gray-500">
                          {t("customers.list.contact")}
                        </dt>
                        <dd className="break-words text-gray-700">
                          {contact ? (
                            <>
                              <span className="block font-medium text-gray-800">
                                {contact.name}
                              </span>
                              <span className="block text-xs">
                                {contact.phone || customer.phone || "–"}
                              </span>
                            </>
                          ) : (
                            customer.phone || t("customers.list.noContact")
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-2xs font-bold uppercase tracking-wide text-gray-500">
                          {t("customers.list.openOrders")}
                        </dt>
                        <dd className="font-bold text-gray-700">
                          {customer._count.workOrder}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-2xs font-bold uppercase tracking-wide text-gray-500">
                          {t("customers.list.lastService")}
                        </dt>
                        <dd className="break-words text-gray-700">
                          {formatDateLocalized(
                            lastServiceDate,
                            locale,
                            undefined,
                            t("customers.list.neverServiced"),
                          )}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                      {showDeleted ? (
                        <form action={restoreCustomerAction}>
                          <input type="hidden" name="id" value={customer.id} />
                          <button
                            type="submit"
                            className="inline-flex min-h-11 items-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-sm font-bold text-emerald-800 hover:bg-emerald-100"
                          >
                            {t("customers.list.restore")}
                          </button>
                        </form>
                      ) : (
                        <>
                          <Link
                            href={`/kunder/${customer.id}`}
                            className="inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-3 text-sm font-bold text-white hover:bg-blue-800"
                          >
                            {t("customers.list.viewDetails")}
                          </Link>
                          {office && (
                            <Link
                              href={`/kunder/${customer.id}/rediger`}
                              className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
                            >
                              {t("customers.list.edit")}
                            </Link>
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
                                className="inline-flex min-h-11 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-bold text-red-700 hover:bg-red-100"
                              >
                                {t("customers.list.delete")}
                              </button>
                            </ConfirmSubmitForm>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Sidebladdring */}
        {totalPages > 1 && (
          <div className="pt-4">
            <Pagination
              page={page}
              totalPages={totalPages}
              hrefFor={linkFor}
              labels={paginationLabels(t)}
              summary={t("customers.list.pagination", { page, totalPages })}
            />
          </div>
        )}

        <p className="text-center text-xs text-gray-500 mt-4">{t("customers.list.total", { total })}</p>

      </div>
    </div>
  );
}
