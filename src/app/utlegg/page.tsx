import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { todayInOslo } from "@/lib/dates";
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
import Card from "@/components/ui/Card";
import { Field, Input } from "@/components/ui";
import { buttonClassName } from "@/components/ui/Button";
import { brandInset } from "@/components/ui/brandStyles";
import Icon from "@/components/icons";

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
  const result = await listMyExpenses(user, { status: param(resolved.status) });
  if (!result.ok) redirect("/");
  const { trips, expenses, totals } = result.data;
  const today = todayInOslo();
  const returnTo = workOrderId ? `/utlegg?oppdrag=${workOrderId}` : "/utlegg";

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
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-4 py-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("expenses.feedback.saved")}
        </p>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">{t("expenses.trip.title")}</h2>
          <form action={createMileageTripAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="workOrderId" value={workOrderId} />
            <input type="hidden" name="visitId" value={visitId} />
            <input type="hidden" name="submit" value="true" />
            <Field id="trip-date" label={t("expenses.date")} required>
              <Input id="trip-date" name="date" type="date" defaultValue={today} required />
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
            <button
              className={`${buttonClassName({ variant: "primary" })} sm:col-span-2`}
              type="submit"
            >
              {t("expenses.trip.submit")}
            </button>
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
              <Input id="expense-date" name="date" type="date" defaultValue={today} required />
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
            <button
              className={`${buttonClassName({ variant: "primary" })} sm:col-span-2`}
              type="submit"
            >
              {t("expenses.expense.submit")}
            </button>
          </form>
        </Card>
      </div>

      <Card as="section" className="p-4 sm:p-5">
        <h2 className="type-eyebrow text-ink">{t("expenses.trip.listTitle")}</h2>
        {trips.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="route" className="h-6 w-6" />}
            title={t("expenses.trip.empty")}
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
                {trips.map((trip) => (
                  <tr key={trip.id}>
                    <td className="tabular-nums">{trip.date}</td>
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
                          <input type="hidden" name="returnTo" value="/utlegg" />
                          <input type="hidden" name="id" value={trip.id} />
                          <button
                            className={buttonClassName({ variant: "secondary", size: "sm" })}
                            type="submit"
                          >
                            {t("expenses.submitToApproval")}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card as="section" className="p-4 sm:p-5">
        <h2 className="type-eyebrow text-ink">{t("expenses.expense.listTitle")}</h2>
        {expenses.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={<Icon name="file" className="h-6 w-6" />}
            title={t("expenses.expense.empty")}
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
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td className="tabular-nums">{expense.date}</td>
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
                          <input type="hidden" name="returnTo" value="/utlegg" />
                          <input type="hidden" name="id" value={expense.id} />
                          <button
                            className={buttonClassName({ variant: "secondary", size: "sm" })}
                            type="submit"
                          >
                            {t("expenses.submitToApproval")}
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageShell>
  );
}
