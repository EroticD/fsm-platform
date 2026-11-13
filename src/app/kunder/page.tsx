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
import AddressLookup from "@/components/customer/AddressLookup";
import CompanyLookup from "@/components/customer/CompanyLookup";
import RegistryStatusBadge from "@/components/customer/RegistryStatusBadge";
import CustomerToast from "@/components/customer/CustomerToast";
import { CUSTOMER_CONTROL, LEGACY_SURFACE } from "@/components/customer/customerStyles";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import FormValuePersistence from "@/components/FormValuePersistence";
import ValidatedForm from "@/components/forms/ValidatedForm";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Card from "@/components/ui/Card";
import { buttonClassName } from "@/components/ui/Button";
import { brandInset } from "@/components/ui/brandStyles";
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
      // Registerstatus fra Enhetsregisteret, vist som merke når den avviker.
      registryStatus: true,
      registryCheckedAt: true,
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
    <PageShell>
      <PageHeader
        eyebrow={t("metadata.routes.kunder")}
        title={t("customers.list.title")}
        subtitle={
          <span className="type-meta type-tabular">
            {t("customers.list.total", { total })}
          </span>
        }
        actions={
          <>
            {user.role === "ADMIN" && (
              <Link
                href={showDeleted ? "/kunder" : "/kunder?slettet=1"}
                prefetch={false}
                className={buttonClassName({ variant: "secondary", size: "sm" })}
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
            <Link
              href="/"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("customers.list.backToDashboard")}
            </Link>
          </>
        }
      />

      {statusKey && <CustomerToast message={t(statusKey)} tone="success" />}

      <ErrorBanner
        message={errorKey ? t(errorKey) : undefined}
      />

      {varsel === "enheter" && (
        <div
          className={`${brandInset} flex items-start gap-2 p-3 text-xs font-bold text-[var(--ink,#101310)]`}
        >
          <Icon name="wrench" className="mt-0.5 h-4 w-4 shrink-0" />
          {t("customers.list.unitsNotice")}
        </div>
      )}

      {showDeleted && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] p-3 text-xs font-bold text-[var(--warning-text,#7a4f0c)]">
          {t("customers.list.deletedTitle")}
        </div>
      )}

      {/* Søk, sortering og «Ny kunde» samlet i én kompakt verktøylinje. */}
      <Card className="overflow-hidden">
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
              <button
                type="submit"
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                {t("customers.list.search")}
              </button>
              {search && (
                <Link
                  href="/kunder"
                  prefetch={false}
                  className={buttonClassName({ variant: "ghost", size: "sm" })}
                >
                  {t("customers.list.reset")}
                </Link>
              )}
            </form>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="type-eyebrow text-[var(--muted,#62685f)]">
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
                    className={`type-ui inline-flex min-h-9 items-center gap-1 rounded-full border px-3 transition ${
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

          {/* Ny kunde er fortsatt sammenlagt som standard. Etter en serverfeil
              åpnes den igjen, slik at feltene brukeren skrev er synlige. */}
          {office && !showDeleted && (
            <details
              className="border-t border-[var(--line,#dedcd1)] pt-3"
              open={Boolean(error)}
            >
              <summary
                className={`${buttonClassName({ variant: "primary", size: "sm" })} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
              >
                <Icon name="plus" className="h-4 w-4 shrink-0" />
                {t("customers.list.newCustomer")}
              </summary>
              <ValidatedForm
                id="office-create-customer"
                action={addCustomer}
                className="mt-3 space-y-3"
              >
                {/* Verdiene lagres ved innsending og legges tilbake når
                    siden vises igjen med ?error=. */}
                <FormValuePersistence
                  formId="office-create-customer"
                  storageKey="fsm:office-create-customer"
                  restore={Boolean(error)}
                />
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <div>
                    <label
                      htmlFor="customer-name"
                      className="type-eyebrow mb-1 block text-[var(--muted,#62685f)]"
                    >
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
                      className="type-eyebrow mb-1 block text-[var(--muted,#62685f)]"
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
                    {/* Oppslaget fyller feltene under, ikke skjemaet selv. */}
                    <div className="mt-1.5">
                      <CompanyLookup />
                    </div>
                  </div>
                  <SubmitButton
                    pendingLabel={t("customers.list.saving")}
                    className={`${buttonClassName({ variant: "primary" })} self-end`}
                  >
                    {t("customers.list.save")}
                  </SubmitButton>
                </div>

                {/* Valgfri adresse og telefon. Navnene må matche feltene
                    CompanyLookup skriver til. */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="customer-address"
                      className="type-eyebrow mb-1 block text-[var(--muted,#62685f)]"
                    >
                      {t("customers.edit.address")}
                    </label>
                    <input
                      id="customer-address"
                      type="text"
                      name="address"
                      autoComplete="street-address"
                      className={CUSTOMER_CONTROL}
                    />
                    {/* Adressesøket fyller adresse, postnummer og poststed. */}
                    <div className="mt-1.5">
                      <AddressLookup />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="customer-postal-code"
                      className="type-eyebrow mb-1 block text-[var(--muted,#62685f)]"
                    >
                      {t("customers.edit.postalCode")}
                    </label>
                    <input
                      id="customer-postal-code"
                      type="text"
                      name="postalCode"
                      autoComplete="postal-code"
                      className={CUSTOMER_CONTROL}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="customer-city"
                      className="type-eyebrow mb-1 block text-[var(--muted,#62685f)]"
                    >
                      {t("customers.edit.city")}
                    </label>
                    <input
                      id="customer-city"
                      type="text"
                      name="city"
                      autoComplete="address-level2"
                      className={CUSTOMER_CONTROL}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="customer-phone"
                      className="type-eyebrow mb-1 block text-[var(--muted,#62685f)]"
                    >
                      {t("customers.edit.phone")}
                    </label>
                    <input
                      id="customer-phone"
                      type="tel"
                      name="phone"
                      autoComplete="tel"
                      className={CUSTOMER_CONTROL}
                    />
                  </div>
                </div>
              </ValidatedForm>
            </details>
          )}
        </div>
      </Card>

      {/* Desktop: tett tabell på papirflate. Hele raden er klikkbar via en
          dekkende lenke; handlingene løftes over lenken. */}
      <Card as="section" className="hidden overflow-hidden md:block">
          <div
            className="overflow-x-auto"
            role="region"
            aria-label={t("customers.list.title")}
            tabIndex={0}
          >
            <table className="office-table min-w-[60rem]">
              <caption className="sr-only">{t("customers.list.title")}</caption>
              <thead>
                <tr>
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
                      style={{ textAlign: index === 6 ? "right" : "left" }}
                      className="whitespace-nowrap"
                    >
                      {column.key ? (
                        <Link
                          href={sortHref(column.key)}
                          prefetch={false}
                          aria-label={t("customers.list.sortBy", {
                            column: column.label,
                          })}
                          className="inline-flex items-center gap-1 font-bold transition hover:text-[var(--ink,#101310)]"
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
                    <td colSpan={7} className="p-4">
                      <EmptyState
                        variant="plain"
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
                              className={buttonClassName({
                                variant: "primary",
                                size: "sm",
                              })}
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
                      <tr key={customer.id} className="group relative transition">
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
                          <span className="relative z-10 mt-0.5 block text-xs text-[var(--muted,#62685f)]">
                            {customer.orgNumber || "–"}
                          </span>
                          {customer.registryStatus &&
                            customer.registryStatus !== "ACTIVE" && (
                              <span className="relative z-10 mt-1 flex">
                                <RegistryStatusBadge
                                  status={customer.registryStatus}
                                  checkedAt={customer.registryCheckedAt}
                                />
                              </span>
                            )}
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
                              <span className="block text-xs text-[var(--muted,#62685f)]">
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
                                  className={buttonClassName({
                                    variant: "secondary",
                                    size: "sm",
                                  })}
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
                                  className={buttonClassName({
                                    variant: "primary",
                                    size: "sm",
                                  })}
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
                                    className={`${buttonClassName({
                                      variant: "secondary",
                                      size: "sm",
                                    })} min-w-9 px-0`}
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
                                      className={`${buttonClassName({
                                        variant: "danger-outline",
                                        size: "sm",
                                      })} min-w-9 px-0`}
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
      </Card>

      {/* Mobil: stablete papirkort med synlige handlinger. */}
      <div className="space-y-3 md:hidden">
        {customers.length === 0 ? (
          <Card className="p-4">
            <EmptyState
              variant="plain"
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
                    className={buttonClassName({
                      variant: "primary",
                      size: "sm",
                    })}
                  >
                    {t("customers.list.reset")}
                  </Link>
                ) : undefined
              }
            />
          </Card>
        ) : (
          customers.map((customer) => {
            const contact = customer.contacts[0] ?? null;
            const lastService = customer.workOrder[0];
            const lastServiceDate =
              lastService?.scheduledFor ?? lastService?.updatedAt ?? null;
            const openOrders = customer._count.workOrder;

            return (
              <Card
                as="article"
                key={customer.id}
                className="space-y-3 p-3"
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
                    <p className="mt-0.5 break-words text-xs text-[var(--muted,#62685f)]">
                      {customer.orgNumber || "–"}
                    </p>
                    {customer.registryStatus &&
                      customer.registryStatus !== "ACTIVE" && (
                        <p className="mt-1">
                          <RegistryStatusBadge
                            status={customer.registryStatus}
                            checkedAt={customer.registryCheckedAt}
                          />
                        </p>
                      )}
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
                    <dt className="type-eyebrow text-[var(--muted,#62685f)]">
                      {t("customers.list.city")}
                    </dt>
                    <dd className="break-words text-[var(--ink,#101310)]">
                      {customer.city || "–"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="type-eyebrow text-[var(--muted,#62685f)]">
                      {t("customers.list.contact")}
                    </dt>
                    <dd className="break-words text-[var(--ink,#101310)]">
                      {contact ? (
                        <>
                          <span className="block font-bold">
                            {contact.name}
                          </span>
                          <span className="block text-[var(--muted,#62685f)]">
                            {contact.phone || customer.phone || "–"}
                          </span>
                        </>
                      ) : (
                        customer.phone || t("customers.list.noContact")
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="type-eyebrow text-[var(--muted,#62685f)]">
                      {t("customers.list.openOrders")}
                    </dt>
                    <dd className="font-bold tabular-nums text-[var(--ink,#101310)]">
                      {openOrders}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="type-eyebrow text-[var(--muted,#62685f)]">
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
                      <button
                        type="submit"
                        className={buttonClassName({
                          variant: "secondary",
                          size: "sm",
                        })}
                      >
                        <Icon name="check" className="h-4 w-4 shrink-0" />
                        {t("customers.list.restore")}
                      </button>
                    </form>
                  ) : (
                    <>
                      <Link
                        href={`/kunder/${customer.id}`}
                        prefetch={false}
                        className={buttonClassName({
                          variant: "primary",
                          size: "sm",
                        })}
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
                          className={buttonClassName({
                            variant: "secondary",
                            size: "sm",
                          })}
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
                            className={buttonClassName({
                              variant: "danger-outline",
                              size: "sm",
                            })}
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
              </Card>
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
    </PageShell>
  );
}
