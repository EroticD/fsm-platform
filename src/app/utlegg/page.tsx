import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateLocalized, todayInOslo } from "@/lib/dates";
import { parsePage } from "@/lib/pagination";
import { DEFAULT_MILEAGE_RATE, DEFAULT_VAT_RATE } from "@/lib/expenses";
import { listMyExpenses } from "@/server/expenses";
import ReceiptUploadField from "./ReceiptUploadField";
import {
  createExpenseAction,
  createMileageTripAction,
  submitExpenseAction,
  submitMileageTripAction,
} from "./actions";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import Pagination, { clampPage, paginationLabels } from "@/components/Pagination";
import CustomerToast from "@/components/customer/CustomerToast";
import IsoDateInput from "@/components/IsoDateInput";
import Card from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui";
import { controlClassName } from "@/components/ui/controlStyles";
import { buttonClassName } from "@/components/ui/Button";
import SubmitButton from "@/components/SubmitButton";
import { brandInset } from "@/components/ui/brandStyles";
import Icon from "@/components/icons";

/** Samme sidebredde som faktura- og tilbudslistene. */
const PAGE_SIZE = 25;

/** Statusene tjenestelaget godtar i `listMyExpenses`. */
const STATUS_FILTERS = ["DRAFT", "PENDING", "APPROVED", "REJECTED"] as const;

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function money(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "NOK",
  }).format(value);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("expenses.title") };
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("fieldExpenses");
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (
    !hasPermission(user, "workorders.view") &&
    !hasPermission(user, "reports.write") &&
    !hasPermission(user, "workorders.update")
  ) {
    redirect("/");
  }

  const resolved = await searchParams;
  const workOrderId = param(resolved.oppdrag);
  const visitId = param(resolved.visitt);
  const meldt = param(resolved.meldt);
  const feil = param(resolved.feil);
  const statusFilter =
    STATUS_FILTERS.find((value) => value === param(resolved.status)) ?? "";
  const result = await listMyExpenses(user, { status: statusFilter });
  if (!result.ok) redirect("/");
  const { trips, expenses, totals } = result.data;
  const today = todayInOslo();

  // `listMyExpenses` paginerer ikke i API-et: den henter de 200 nyeste radene
  // per listetype. Vi paginerer derfor i minnet over det som er hentet, med
  // samme sidebredde og klemming som faktura- og tilbudslistene. Kjøreturer og
  // utlegg har hver sin `?turside=`/`?side=`, slik at blaing i den ene listen
  // ikke flytter den andre.
  const tripTotalPages = Math.max(1, Math.ceil(trips.length / PAGE_SIZE));
  const tripPage = clampPage(parsePage(param(resolved.turside)), tripTotalPages);
  const visibleTrips = trips.slice(
    (tripPage - 1) * PAGE_SIZE,
    tripPage * PAGE_SIZE,
  );

  const expenseTotalPages = Math.max(1, Math.ceil(expenses.length / PAGE_SIZE));
  const expensePage = clampPage(
    parsePage(param(resolved.side)),
    expenseTotalPages,
  );
  const visibleExpenses = expenses.slice(
    (expensePage - 1) * PAGE_SIZE,
    expensePage * PAGE_SIZE,
  );

  // Bevarer filteret og oppdrags-/besøkskoblingen når brukeren blar eller
  // bytter status. Kvitteringsparameterne (`meldt`, `feil`) er ikke med.
  const hrefWith = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams();
    if (statusFilter) next.set("status", statusFilter);
    if (workOrderId) next.set("oppdrag", workOrderId);
    if (visitId) next.set("visitt", visitId);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const text = next.toString();
    return text ? `/utlegg?${text}` : "/utlegg";
  };

  // Skjemaene redirecter tilbake hit, slik at et påbegynt filter og en
  // oppdragskobling overlever innsendingen.
  const returnTo = hrefWith({});

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("expenses.eyebrow")}
        title={t("expenses.title")}
        subtitle={t("expenses.description")}
        icon={<Icon name="route" className="h-5 w-5" />}
        actions={
          <>
            <div className={`${brandInset} px-3 py-2`}>
              <p className="type-eyebrow text-muted">{t("expenses.totals.pending")}</p>
              <p className="font-black tabular-nums">{money(totals.pendingAmount, locale)}</p>
            </div>
            <div className={`${brandInset} px-3 py-2`}>
              <p className="type-eyebrow text-muted">{t("expenses.totals.approved")}</p>
              <p className="font-black tabular-nums">{money(totals.approvedAmount, locale)}</p>
            </div>
            <Link
              className={buttonClassName({ variant: "secondary", size: "sm" })}
              href="/utlegg/kontor"
            >
              {t("expenses.officeLink")}
            </Link>
          </>
        }
      />

      {meldt && (
        <CustomerToast
          message={t("expenses.feedback.saved")}
          clearParams={["meldt"]}
        />
      )}
      <ErrorBanner message={feil ? t("expenses.feedback.error") : undefined} />

      {workOrderId && (
        <div className={`${brandInset} px-4 py-3 text-sm font-bold`}>
          {t("expenses.linkedWorkOrder")}:{" "}
          <Link className="underline underline-offset-2" href={`/oppdrag/${workOrderId}`}>
            {workOrderId}
          </Link>
        </div>
      )}

      <Card as="section" className="p-3 sm:p-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          {workOrderId ? (
            <input type="hidden" name="oppdrag" value={workOrderId} />
          ) : null}
          {visitId ? <input type="hidden" name="visitt" value={visitId} /> : null}
          <Field id="expenses-status" label={t("expenses.filter.status")}>
            <Select id="expenses-status" name="status" defaultValue={statusFilter}>
              <option value="">{t("expenses.filter.allStatuses")}</option>
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {t(`expenses.status.${value.toLowerCase()}`)}
                </option>
              ))}
            </Select>
          </Field>
          <button
            type="submit"
            className={buttonClassName({ variant: "secondary" })}
          >
            <Icon name="search" className="h-4 w-4" />
            {t("search")}
          </button>
          {statusFilter ? (
            <Link
              href={hrefWith({ status: null, side: null, turside: null })}
              className={buttonClassName({ variant: "ghost" })}
            >
              {t("expenses.filter.reset")}
            </Link>
          ) : null}
        </form>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">{t("expenses.trip.title")}</h2>
          <form action={createMileageTripAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="workOrderId" value={workOrderId} />
            <input type="hidden" name="visitId" value={visitId} />
            <input type="hidden" name="submit" value="true" />
            <Field id="trip-date" label={t("expenses.date")} required>
              <IsoDateInput
                id="trip-date"
                name="date"
                defaultValue={today}
                required
                className={controlClassName()}
              />
            </Field>
            <Field id="trip-km" label={t("expenses.trip.km")} required>
              <Input id="trip-km" name="km" type="number" step="0.01" min="0.01" required />
            </Field>
            <Field id="trip-from" label={t("expenses.trip.from")} required>
              <Input id="trip-from" name="fromAddress" required />
            </Field>
            <Field id="trip-to" label={t("expenses.trip.to")} required>
              <Input id="trip-to" name="toAddress" required />
            </Field>
            <Field id="trip-rate" label={t("expenses.trip.rate")}>
              <Input
                id="trip-rate"
                name="rate"
                type="number"
                step="0.0001"
                min="0"
                defaultValue={DEFAULT_MILEAGE_RATE}
              />
            </Field>
            <Field id="trip-purpose" label={t("expenses.trip.purpose")}>
              <Input id="trip-purpose" name="purpose" />
            </Field>
            <SubmitButton
              className={`${buttonClassName({ variant: "primary" })} sm:col-span-2`}
              pendingLabel={t("orders.edit.saving")}
            >
              {t("expenses.trip.submit")}
            </SubmitButton>
          </form>
        </Card>

        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">{t("expenses.expense.title")}</h2>
          <form action={createExpenseAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="workOrderId" value={workOrderId} />
            <input type="hidden" name="visitId" value={visitId} />
            <input type="hidden" name="submit" value="true" />
            <Field id="expense-date" label={t("expenses.date")} required>
              <IsoDateInput
                id="expense-date"
                name="date"
                defaultValue={today}
                required
                className={controlClassName()}
              />
            </Field>
            <Field id="expense-category" label={t("expenses.expense.category")} required>
              <Input id="expense-category" name="category" required />
            </Field>
            <Field id="expense-amount" label={t("expenses.expense.amount")} required>
              <Input id="expense-amount" name="amount" type="number" step="0.01" min="0.01" required />
            </Field>
            <Field id="expense-vat" label={t("expenses.expense.vatRate")}>
              <Input
                id="expense-vat"
                name="vatRate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                defaultValue={DEFAULT_VAT_RATE}
              />
            </Field>
            <Field
              id="expense-description"
              label={t("expenses.expense.description")}
              className="sm:col-span-2"
            >
              <Input id="expense-description" name="description" />
            </Field>
            <div className="sm:col-span-2">
              <ReceiptUploadField
                workOrderId={workOrderId || undefined}
                label={t("expenses.expense.receipt")}
                uploadingLabel={t("expenses.expense.uploading")}
                errorLabel={t("expenses.expense.uploadError")}
              />
            </div>
            <SubmitButton
              className={`${buttonClassName({ variant: "primary" })} sm:col-span-2`}
              pendingLabel={t("orders.edit.saving")}
            >
              {t("expenses.expense.submit")}
            </SubmitButton>
          </form>
        </Card>
      </div>

      <Card as="section" className="p-4 sm:p-5">
        <h2 className="type-eyebrow text-ink">{t("expenses.trip.listTitle")}</h2>
        {trips.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="route" className="h-6 w-6" />}
            title={
              statusFilter
                ? t("expenses.trip.emptyFiltered")
                : t("expenses.trip.empty")
            }
          />
        ) : (
          <div
            className="mt-3 overflow-x-auto"
            role="region"
            aria-label={t("expenses.trip.listTitle")}
            tabIndex={0}
          >
            <table className="office-table min-w-[46rem]">
              <thead>
                <tr>
                  <th scope="col">{t("expenses.date")}</th>
                  <th scope="col">{t("expenses.trip.route")}</th>
                  <th scope="col" className="text-right">{t("expenses.trip.km")}</th>
                  <th scope="col" className="text-right">{t("expenses.amount")}</th>
                  <th scope="col">{t("expenses.statusLabel")}</th>
                  <th scope="col">{t("expenses.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleTrips.map((trip) => (
                  <tr key={trip.id}>
                    <td className="tabular-nums">{formatDateLocalized(trip.date, locale)}</td>
                    <td>
                      {trip.fromAddress} → {trip.toAddress}
                      {trip.workOrderId && (
                        <Link className="ml-2 text-xs underline" href={`/oppdrag/${trip.workOrderId}`}>
                          {t("expenses.openWorkOrder")}
                        </Link>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{trip.km}</td>
                    <td className="text-right font-bold tabular-nums">{money(trip.amount, locale)}</td>
                    <td className="text-xs font-bold">
                      {t(`expenses.status.${trip.status.toLowerCase()}`)}
                      {trip.rejectionReason && (
                        <span className="block font-normal text-[var(--risk-text,#b42318)]">
                          {trip.rejectionReason}
                        </span>
                      )}
                    </td>
                    <td>
                      {trip.status === "DRAFT" && (
                        <form action={submitMileageTripAction}>
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="id" value={trip.id} />
                          <SubmitButton
                            className={buttonClassName({ variant: "secondary", size: "sm" })}
                            pendingLabel={t("orders.fieldDetail.updating")}
                          >
                            {t("expenses.submitToApproval")}
                          </SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={tripPage}
          totalPages={tripTotalPages}
          hrefFor={(target) =>
            hrefWith({
              turside: target > 1 ? String(target) : null,
              side: expensePage > 1 ? String(expensePage) : null,
            })
          }
          labels={{ ...paginationLabels(t), label: t("expenses.trip.pagination") }}
          className="mt-3"
        />
      </Card>

      <Card as="section" className="p-4 sm:p-5">
        <h2 className="type-eyebrow text-ink">{t("expenses.expense.listTitle")}</h2>
        {expenses.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="file" className="h-6 w-6" />}
            title={
              statusFilter
                ? t("expenses.expense.emptyFiltered")
                : t("expenses.expense.empty")
            }
          />
        ) : (
          <div
            className="mt-3 overflow-x-auto"
            role="region"
            aria-label={t("expenses.expense.listTitle")}
            tabIndex={0}
          >
            <table className="office-table min-w-[46rem]">
              <thead>
                <tr>
                  <th scope="col">{t("expenses.date")}</th>
                  <th scope="col">{t("expenses.expense.category")}</th>
                  <th scope="col" className="text-right">{t("expenses.amount")}</th>
                  <th scope="col" className="text-right">{t("expenses.vat")}</th>
                  <th scope="col">{t("expenses.receipt")}</th>
                  <th scope="col">{t("expenses.statusLabel")}</th>
                  <th scope="col">{t("expenses.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleExpenses.map((expense) => (
                  <tr key={expense.id}>
                    <td className="tabular-nums">{formatDateLocalized(expense.date, locale)}</td>
                    <td>
                      {expense.category}
                      {expense.description && (
                        <span className="block text-xs text-muted">{expense.description}</span>
                      )}
                    </td>
                    <td className="text-right font-bold tabular-nums">{money(expense.amount, locale)}</td>
                    <td className="text-right tabular-nums">{money(expense.vatAmount, locale)}</td>
                    <td className="text-xs">
                      {expense.receiptUrl ? (
                        <a className="underline" href={expense.receiptUrl} target="_blank" rel="noreferrer">
                          {t("expenses.receipt")}
                        </a>
                      ) : expense.documentId ? (
                        <Link className="underline" href={`/dokumenter?dokument=${expense.documentId}`}>
                          {t("expenses.document")}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="text-xs font-bold">
                      {t(`expenses.status.${expense.status.toLowerCase()}`)}
                      {expense.rejectionReason && (
                        <span className="block font-normal text-[var(--risk-text,#b42318)]">
                          {expense.rejectionReason}
                        </span>
                      )}
                    </td>
                    <td>
                      {expense.status === "DRAFT" && (
                        <form action={submitExpenseAction}>
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="id" value={expense.id} />
                          <SubmitButton
                            className={buttonClassName({ variant: "secondary", size: "sm" })}
                            pendingLabel={t("orders.fieldDetail.updating")}
                          >
                            {t("expenses.submitToApproval")}
                          </SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={expensePage}
          totalPages={expenseTotalPages}
          hrefFor={(target) =>
            hrefWith({
              side: target > 1 ? String(target) : null,
              turside: tripPage > 1 ? String(tripPage) : null,
            })
          }
          labels={{ ...paginationLabels(t), label: t("expenses.expense.pagination") }}
          className="mt-3"
        />
      </Card>
    </PageShell>
  );
}
