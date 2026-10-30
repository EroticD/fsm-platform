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
import {
  CUSTOMER_CARD,
  CUSTOMER_CONTROL,
  CUSTOMER_EYEBROW,
  CUSTOMER_INK_BUTTON,
  CUSTOMER_INSET,
  CUSTOMER_LABEL,
  CUSTOMER_MUTED,
  CUSTOMER_RISK_BUTTON,
  CUSTOMER_SIGNAL_BUTTON,
  LEGACY_SURFACE,
} from "@/components/customer/customerStyles";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import Icon from "@/components/icons";
import Pagination, { paginationLabels } from "@/components/Pagination";
import SubmitButton from "@/components/SubmitButton";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

type SortKey = "name" | "city" | "orgNumber";

const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; labelKey: string }> = [
  { key: "name", labelKey: "customers.list.companyName" },
  { key: "city", labelKey: "customers.list.city" },
  { key: "orgNumber", labelKey: "customers.list.orgNumber" },
];

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
    if (sortKey !== key) {
      return <Icon name="chevronDown" className="h-3.5 w-3.5 opacity-40" />;
    }
    return (
      <Icon
        name="chevronDown"
        className={`h-3.5 w-3.5 ${sortDir === "asc" ? "rotate-180" : ""}`}
      />
    );
  };

  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" => {
    if (sortKey !== key) return "none";
    return sortDir === "asc" ? "ascending" : "descending";
  };

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-col gap-3 border-b border-[var(--line,#dedcd1)] pb-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className={CUSTOMER_EYEBROW}>{t("metadata.routes.kunder")}</p>
            <h1 className="mt-0.5 flex flex-wrap items-baseline gap-2 text-3xl font-black tracking-tight text-[var(--ink,#101310)] md:text-4xl">
              <span className="truncate">{t("customers.list.title")}</span>
              <span className={`text-sm font-bold tabular-nums ${CUSTOMER_MUTED}`}>
                {t("customers.list.total", { total })}
              </span>
            </h1>
          </div>
          <div className="flex w-full flex-wrap gap-2 md:w-auto">
            {user.role === "ADMIN" && (
              <Link
                href={showDeleted ? "/kunder" : "/kunder?slettet=1"}
                prefetch={false}
                className={CUSTOMER_INK_BUTTON}
              >
                <Icon
                  name={showDeleted ? "chevronRight" : "trash"}
                  className={`h-4 w-4 shrink-0 ${showDeleted ? "rotate-180" : ""}`}
                />
                {showDeleted
                  ? t("customers.list.showActive")
                  : t("customers.list.showDeleted")}
              </Link>
            )}
            <Link href="/" className={CUSTOMER_INK_BUTTON}>
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("customers.list.backToDashboard")}
            </Link>
          </div>
        </header>

        {statusKey && <CustomerToast message={t(statusKey)} tone="success" />}

        <ErrorBanner
          message={errorKey ? t(errorKey) : undefined}
        />

        {varsel === "enheter" && (
          <div
            className={`${CUSTOMER_INSET} flex items-start gap-2 p-3 text-xs font-bold text-[var(--ink,#101310)]`}
          >
            <Icon name="wrench" className="mt-0.5 h-4 w-4 shrink-0" />
            {t("customers.list.unitsNotice")}
          </div>
        )}

        {showDeleted && (
          <div className="rounded-xl border border-[#e4c98f] bg-[#fdf5e4] p-3 text-xs font-bold text-[#6b4808]">
            {t("customers.list.deletedTitle")}
          </div>
        )}

        {/* Søk, sortering og «Ny kunde» samlet i én kompakt verktøylinje. */}
        <section className={`${CUSTOMER_CARD} overflow-hidden`}>
          <div className="space-y-3 p-3 sm:p-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <form
                method="GET"
                action="/kunder"
                className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
              >
                {showDeleted && <input type="hidden" name="slettet" value="1" />}
                {sortKey !== "name" && (
                  <input type="hidden" name="sort" value={sortKey} />
                )}
                {sortDir !== "asc" && (
                  <input type="hidden" name="dir" value={sortDir} />
                )}
                <div className="relative min-w-[14rem] flex-1">
                  <Icon
                    name="search"
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted,#62685f)]"
                  />
                  <input
                    type="search"
                    name="q"
                    defaultValue={search}
                    aria-label={t("customers.list.searchPlaceholder")}
                    placeholder={t("customers.list.searchPlaceholder")}
                    className={`${CUSTOMER_CONTROL} pl-9 text-sm`}
                  />
                </div>
                <button type="submit" className={CUSTOMER_INK_BUTTON}>
                  {t("customers.list.search")}
                </button>
                {search && (
                  <Link
                    href="/kunder"
                    prefetch={false}
                    className={CUSTOMER_INK_BUTTON}
                  >
                    {t("customers.list.reset")}
                  </Link>
                )}
              </form>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className={CUSTOMER_EYEBROW}>
                  {t("orders.list.sortLabel")}
                </span>
                {SORT_OPTIONS.map((option) => {
                  const active = sortKey === option.key;
                  return (
                    <Link
                      key={option.key}
                      href={sortHref(option.key)}
                      prefetch={false}
                      aria-current={active ? "true" : undefined}
                      className={`inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-xs font-bold transition ${
                        active
                          ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                          : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)]"
                      }`}
                    >
                      {t(option.labelKey)}
                      <span aria-hidden="true" className="inline-flex">
                        {sortIndicator(option.key)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Ny kunde er fortsatt sammenlagt som standard. */}
            {office && !showDeleted && (
              <details className="border-t border-[var(--line,#dedcd1)] pt-3">
                <summary
                  className={`${CUSTOMER_SIGNAL_BUTTON} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
                >
                  <Icon name="plus" className="h-4 w-4 shrink-0" />
                  {t("customers.list.newCustomer")}
                </summary>
                <form
                  action={addCustomer}
                  className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <div>
                    <label htmlFor="customer-name" className={CUSTOMER_LABEL}>
                      {t("customers.list.companyName")}
                    </label>
                    <input
                      id="customer-name"
                      type="text"
                      name="name"
                      placeholder={t("customers.list.namePlaceholder")}
                      required
                      aria-required="true"
                      className={CUSTOMER_CONTROL}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="customer-org-number"
                      className={CUSTOMER_LABEL}
                    >
                      {t("customers.list.orgNumber")}
                    </label>
                    <input
                      id="customer-org-number"
                      type="text"
                      name="orgNumber"
                      placeholder={t("customers.list.orgNumberPlaceholder")}
                      className={CUSTOMER_CONTROL}
                    />
                  </div>
                  <SubmitButton
                    pendingLabel={t("customers.list.saving")}
                    className={`${CUSTOMER_SIGNAL_BUTTON} self-end`}
                  >
                    {t("customers.list.save")}
                  </SubmitButton>
                </form>
              </details>
            )}
          </div>
        </section>

        {/* Desktop: tett tabell på papirflate. Hele raden er klikkbar via en
            dekkende lenke; handlingene løftes over lenken. */}
        <section className={`${CUSTOMER_CARD} hidden overflow-hidden md:block`}>
          <div
            className="overflow-x-auto"
            role="region"
            aria-label={t("customers.list.title")}
            tabIndex={0}
          >
            <table className="office-table min-w-[60rem]">
              <caption className="sr-only">{t("customers.list.title")}</caption>
              <thead>
                <tr
                  style={{
                    backgroundColor: "var(--ink, #101310)",
                    color: "var(--paper, #f2efe6)",
                  }}
                >
                  {(
                    [
                      { key: "name", label: t("customers.list.companyName") },
                      { key: "city", label: t("customers.list.city") },
                      { key: null, label: t("customers.list.contact") },
                      {
                        key: "orgNumber",
                        label: t("customers.list.orgNumber"),
                      },
                      { key: null, label: t("customers.list.openOrders") },
                      { key: null, label: t("customers.list.lastService") },
                      { key: null, label: t("customers.list.actions") },
                    ] as const
                  ).map((column, index) => (
                    <th
                      key={`${column.label}-${index}`}
                      scope="col"
                      aria-sort={
                        column.key ? ariaSort(column.key) : undefined
                      }
                      style={{
                        color: "var(--paper, #f2efe6)",
                        borderBottomColor: "var(--signal, #d8ff3e)",
                        borderBottomWidth: "2px",
                        fontSize: "0.75rem",
                        textAlign: index === 6 ? "right" : "left",
                      }}
                      className="whitespace-nowrap"
                    >
                      {column.key ? (
                        <Link
                          href={sortHref(column.key)}
                          prefetch={false}
                          aria-label={t("customers.list.sortBy", {
                            column: column.label,
                          })}
                          className="inline-flex items-center gap-1 font-bold text-[var(--paper,#f2efe6)] transition hover:text-[var(--signal,#d8ff3e)]"
                        >
                          {column.label}
                          <span aria-hidden="true">
                            {sortIndicator(column.key)}
                          </span>
                        </Link>
                      ) : (
                        column.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className={`p-4 ${LEGACY_SURFACE}`}>
                      <EmptyState
                        icon={<Icon name="building" className="h-8 w-8" />}
                        title={
                          search
                            ? t("customers.list.noMatches", { query: search })
                            : t("customers.list.empty")
                        }
                        action={
                          search ? (
                            <Link
                              href={showDeleted ? "/kunder?slettet=1" : "/kunder"}
                              prefetch={false}
                              className={CUSTOMER_SIGNAL_BUTTON}
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
                    const openOrders = customer._count.workOrder;

                    return (
                      <tr
                        key={customer.id}
                        className="group relative border-b border-[var(--line,#dedcd1)] transition last:border-0 hover:bg-[var(--paper,#f2efe6)]/60"
                      >
                        <td className="max-w-[22rem] px-3 py-2 align-top">
                          <Link
                            href={`/kunder/${customer.id}`}
                            prefetch={false}
                            aria-label={t("customers.list.openCustomer", {
                              name: customer.name,
                            })}
                            className="absolute inset-0 z-0"
                          />
                          <span className="relative z-10 block truncate font-bold text-[var(--ink,#101310)]">
                            {customer.name}
                          </span>
                          <span
                            className={`relative z-10 mt-0.5 block text-xs ${CUSTOMER_MUTED}`}
                          >
                            {customer.orgNumber || "–"}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-[var(--muted,#62685f)]">
                          {customer.city || "–"}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {contact ? (
                            <>
                              <span className="block text-xs font-bold text-[var(--ink,#101310)]">
                                {contact.name}
                              </span>
                              <span
                                className={`block text-xs ${CUSTOMER_MUTED}`}
                              >
                                {contact.phone || customer.phone || "–"}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-[var(--muted,#62685f)]">
                              {customer.phone || t("customers.list.noContact")}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-[var(--muted,#62685f)]">
                          {customer.orgNumber || "–"}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span
                            className={`inline-flex min-h-6 min-w-8 items-center justify-center gap-1 rounded-full border px-2 text-xs font-bold ${
                              openOrders > 0
                                ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                                : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]"
                            }`}
                          >
                            <Icon name="folder" className="h-3.5 w-3.5" />
                            {openOrders}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-[var(--muted,#62685f)]">
                          {formatDateLocalized(
                            lastServiceDate,
                            locale,
                            undefined,
                            t("customers.list.neverServiced"),
                          )}
                        </td>
                        <td className="relative z-10 px-3 py-2">
                          <div className="flex items-center justify-end gap-1.5">
                            {showDeleted ? (
                              <form action={restoreCustomerAction}>
                                <input
                                  type="hidden"
                                  name="id"
                                  value={customer.id}
                                />
                                <button
                                  type="submit"
                                  className={CUSTOMER_INK_BUTTON}
                                >
                                  <Icon
                                    name="check"
                                    className="h-4 w-4 shrink-0"
                                  />
                                  {t("customers.list.restore")}
                                </button>
                              </form>
                            ) : (
                              <>
                                <Link
                                  href={`/kunder/${customer.id}`}
                                  prefetch={false}
                                  className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-md border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-2 text-xs font-bold text-[var(--ink,#101310)] shadow-[1px_1px_0_var(--ink,#101310)] transition hover:translate-x-px hover:translate-y-px hover:shadow-none"
                                >
                                  {t("customers.list.viewDetails")}
                                  <Icon
                                    name="arrowRight"
                                    className="h-3.5 w-3.5 shrink-0"
                                  />
                                </Link>
                                {office && (
                                  <Link
                                    href={`/kunder/${customer.id}/rediger`}
                                    prefetch={false}
                                    aria-label={t("customers.list.edit")}
                                    title={t("customers.list.edit")}
                                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
                                  >
                                    <Icon name="edit" className="h-4 w-4" />
                                  </Link>
                                )}
                                {user.role === "ADMIN" && (
                                  <ConfirmSubmitForm
                                    action={deleteCustomerAction}
                                    confirmMessage={t(
                                      "customers.list.deleteConfirm",
                                      { name: customer.name },
                                    )}
                                    confirmLabel={t("delete")}
                                    danger
                                    className="inline-flex"
                                  >
                                    <input
                                      type="hidden"
                                      name="id"
                                      value={customer.id}
                                    />
                                    <button
                                      type="submit"
                                      aria-label={t("customers.list.delete")}
                                      title={t("customers.list.delete")}
                                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)] transition hover:border-[var(--risk-text,#b42318)] hover:bg-[#fbe9e7]"
                                    >
                                      <Icon name="trash" className="h-4 w-4" />
                                    </button>
                                  </ConfirmSubmitForm>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Mobil: stablete papirkort med synlige handlinger. */}
        <div className="space-y-3 md:hidden">
          {customers.length === 0 ? (
            <div className={`${CUSTOMER_CARD} p-4 ${LEGACY_SURFACE}`}>
              <EmptyState
                icon={<Icon name="building" className="h-8 w-8" />}
                title={
                  search
                    ? t("customers.list.noMatches", { query: search })
                    : t("customers.list.empty")
                }
                action={
                  search ? (
                    <Link
                      href={showDeleted ? "/kunder?slettet=1" : "/kunder"}
                      prefetch={false}
                      className={CUSTOMER_SIGNAL_BUTTON}
                    >
                      {t("customers.list.reset")}
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            customers.map((customer) => {
              const contact = customer.contacts[0] ?? null;
              const lastService = customer.workOrder[0];
              const lastServiceDate =
                lastService?.scheduledFor ?? lastService?.updatedAt ?? null;
              const openOrders = customer._count.workOrder;

              return (
                <article
                  key={customer.id}
                  className={`${CUSTOMER_CARD} space-y-3 p-3`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/kunder/${customer.id}`}
                        prefetch={false}
                        className="break-words text-base font-bold text-[var(--ink,#101310)] hover:underline"
                      >
                        {customer.name}
                      </Link>
                      <p
                        className={`mt-0.5 break-words text-xs ${CUSTOMER_MUTED}`}
                      >
                        {customer.orgNumber || "–"}
                      </p>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${
                        openOrders > 0
                          ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                          : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]"
                      }`}
                    >
                      <Icon name="folder" className="h-3.5 w-3.5" />
                      {openOrders} {t("customers.list.openOrders")}
                    </span>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div className="min-w-0">
                      <dt className={CUSTOMER_EYEBROW}>
                        {t("customers.list.city")}
                      </dt>
                      <dd className="break-words text-[var(--ink,#101310)]">
                        {customer.city || "–"}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className={CUSTOMER_EYEBROW}>
                        {t("customers.list.contact")}
                      </dt>
                      <dd className="break-words text-[var(--ink,#101310)]">
                        {contact ? (
                          <>
                            <span className="block font-bold">
                              {contact.name}
                            </span>
                            <span className={`block ${CUSTOMER_MUTED}`}>
                              {contact.phone || customer.phone || "–"}
                            </span>
                          </>
                        ) : (
                          customer.phone || t("customers.list.noContact")
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className={CUSTOMER_EYEBROW}>
                        {t("customers.list.openOrders")}
                      </dt>
                      <dd className="font-bold tabular-nums text-[var(--ink,#101310)]">
                        {openOrders}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className={CUSTOMER_EYEBROW}>
                        {t("customers.list.lastService")}
                      </dt>
                      <dd className="break-words text-[var(--ink,#101310)]">
                        {formatDateLocalized(
                          lastServiceDate,
                          locale,
                          undefined,
                          t("customers.list.neverServiced"),
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line,#dedcd1)] pt-3">
                    {showDeleted ? (
                      <form action={restoreCustomerAction}>
                        <input type="hidden" name="id" value={customer.id} />
                        <button type="submit" className={CUSTOMER_INK_BUTTON}>
                          <Icon name="check" className="h-4 w-4 shrink-0" />
                          {t("customers.list.restore")}
                        </button>
                      </form>
                    ) : (
                      <>
                        <Link
                          href={`/kunder/${customer.id}`}
                          prefetch={false}
                          className={CUSTOMER_SIGNAL_BUTTON}
                        >
                          {t("customers.list.viewDetails")}
                          <Icon
                            name="arrowRight"
                            className="h-3.5 w-3.5 shrink-0"
                          />
                        </Link>
                        {office && (
                          <Link
                            href={`/kunder/${customer.id}/rediger`}
                            prefetch={false}
                            className={CUSTOMER_INK_BUTTON}
                          >
                            <Icon name="edit" className="h-4 w-4 shrink-0" />
                            {t("customers.list.edit")}
                          </Link>
                        )}
                        {user.role === "ADMIN" && (
                          <ConfirmSubmitForm
                            action={deleteCustomerAction}
                            confirmMessage={t(
                              "customers.list.deleteConfirm",
                              { name: customer.name },
                            )}
                            confirmLabel={t("delete")}
                            danger
                            className="inline-flex"
                          >
                            <input
                              type="hidden"
                              name="id"
                              value={customer.id}
                            />
                            <button
                              type="submit"
                              className={CUSTOMER_RISK_BUTTON}
                            >
                              <Icon
                                name="trash"
                                className="h-4 w-4 shrink-0"
                              />
                              {t("customers.list.delete")}
                            </button>
                          </ConfirmSubmitForm>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>

        {totalPages > 1 && (
          <div className={`pt-1 ${LEGACY_SURFACE}`}>
            <Pagination
              page={page}
              totalPages={totalPages}
              hrefFor={linkFor}
              labels={paginationLabels(t)}
              summary={t("customers.list.pagination", { page, totalPages })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
