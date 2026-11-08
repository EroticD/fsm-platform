import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateTimeLocalized, todayInOslo } from "@/lib/dates";
import {
  listApprovalQueue,
  listPayrollExports,
  previewPayroll,
} from "@/server/expenses";
import {
  approveExpenseAction,
  approveMileageTripAction,
  rejectExpenseAction,
  rejectMileageTripAction,
} from "../actions";
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

function monthStart(date: string): string {
  return `${date.slice(0, 8)}01`;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("expenses.office.title") };
}

export default async function ExpenseOfficePage({
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
    !hasPermission(user, "workorders.edit") &&
    !hasPermission(user, "settings.manage") &&
    !hasPermission(user, "workorders.update")
  ) {
    redirect("/");
  }

  const resolved = await searchParams;
  const meldt = param(resolved.meldt);
  const feil = param(resolved.feil);
  const status = param(resolved.status) || "PENDING";
  const today = todayInOslo();
  const start = param(resolved.start) || monthStart(today);
  const end = param(resolved.end) || today;

  const [queueResult, previewResult, exportsResult] = await Promise.all([
    listApprovalQueue(user, { status }),
    previewPayroll(user, { start, end }),
    listPayrollExports(user),
  ]);
  if (!queueResult.ok) redirect("/");
  const { trips, expenses, totals } = queueResult.data;
  const preview = previewResult.ok ? previewResult.data : null;
  const exportHistory = exportsResult.ok ? exportsResult.data.exports : [];

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("expenses.eyebrow")}
        title={t("expenses.office.title")}
        subtitle={t("expenses.office.description")}
        icon={<Icon name="check" className="h-5 w-5" />}
        actions={
          <Link
            className={buttonClassName({ variant: "secondary", size: "sm" })}
            href="/utlegg"
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("expenses.office.myExpenses")}
          </Link>
        }
      />

      {meldt && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-4 py-3 text-sm font-bold text-[var(--success-text,#283509)]">
          {t("expenses.feedback.saved")}
        </p>
      )}
      <ErrorBanner message={feil ? t("expenses.feedback.error") : undefined} />

      <div className="flex flex-wrap gap-2">
        {["PENDING", "APPROVED", "REJECTED"].map((value) => (
          <Link
            key={value}
            href={`/utlegg/kontor?status=${value}`}
            aria-current={status === value ? "true" : undefined}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
              status === value
                ? "border-ink bg-ink text-paper"
                : "border-line bg-surface text-ink hover:border-ink"
            }`}
          >
            {t(`expenses.status.${value.toLowerCase()}`)}
          </Link>
        ))}
      </div>

      <div className={`${brandInset} px-4 py-3 text-sm font-bold`}>
        {t("expenses.office.pendingSummary", {
          count: totals.pendingCount,
          amount: money(totals.pendingAmount, locale),
        })}
      </div>

      <div data-expense-approval className="space-y-4">
        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">
            {t("expenses.trip.approvalTitle")}
          </h2>
          {trips.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={<Icon name="route" className="h-6 w-6" />}
              title={t("expenses.office.empty")}
            />
          ) : (
            <div className="mt-3 space-y-3">
              {trips.map((trip) => (
                <div key={trip.id} className={`${brandInset} p-3`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 text-sm">
                      <p className="font-bold">
                        {trip.userName} · {trip.date}
                      </p>
                      <p>{trip.fromAddress} → {trip.toAddress}</p>
                      <p className="text-xs text-muted">
                        {trip.km} km × {trip.rate} kr = {money(trip.amount, locale)}
                        {trip.purpose ? ` · ${trip.purpose}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full border border-line px-2.5 py-1 text-xs font-bold">
                      {t(`expenses.status.${trip.status.toLowerCase()}`)}
                    </span>
                  </div>
                  {trip.status === "PENDING" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <form action={approveMileageTripAction}>
                        <input type="hidden" name="returnTo" value={`/utlegg/kontor?status=${status}`} />
                        <input type="hidden" name="id" value={trip.id} />
                        <button
                          className={buttonClassName({ variant: "primary", size: "sm" })}
                          type="submit"
                        >
                          {t("expenses.approve")}
                        </button>
                      </form>
                      <form action={rejectMileageTripAction} className="flex flex-1 flex-wrap items-center gap-2">
                        <input type="hidden" name="returnTo" value={`/utlegg/kontor?status=${status}`} />
                        <input type="hidden" name="id" value={trip.id} />
                        <Input
                          name="reason"
                          placeholder={t("expenses.rejectReason")}
                          aria-label={t("expenses.rejectReason")}
                          required
                          className="min-w-40 flex-1"
                        />
                        <button
                          className={buttonClassName({ variant: "danger-outline", size: "sm" })}
                          type="submit"
                        >
                          {t("expenses.reject")}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card as="section" className="p-4 sm:p-5">
          <h2 className="type-eyebrow text-ink">
            {t("expenses.expense.approvalTitle")}
          </h2>
          {expenses.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={<Icon name="file" className="h-6 w-6" />}
              title={t("expenses.office.empty")}
            />
          ) : (
            <div className="mt-3 space-y-3">
              {expenses.map((expense) => (
                <div key={expense.id} className={`${brandInset} p-3`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 text-sm">
                      <p className="font-bold">
                        {expense.userName} · {expense.date} · {expense.category}
                      </p>
                      <p>
                        {money(expense.amount, locale)} ({t("expenses.vat")}{" "}
                        {money(expense.vatAmount, locale)})
                      </p>
                      {expense.description && (
                        <p className="text-xs text-muted">{expense.description}</p>
                      )}
                      <p className="text-xs">
                        {expense.receiptUrl ? (
                          <a className="underline" href={expense.receiptUrl} target="_blank" rel="noreferrer">
                            {t("expenses.receipt")}
                          </a>
                        ) : expense.documentId ? (
                          <Link className="underline" href={`/dokumenter?dokument=${expense.documentId}`}>
                            {t("expenses.document")}
                          </Link>
                        ) : (
                          t("expenses.office.noReceipt")
                        )}
                      </p>
                    </div>
                    <span className="rounded-full border border-line px-2.5 py-1 text-xs font-bold">
                      {t(`expenses.status.${expense.status.toLowerCase()}`)}
                    </span>
                  </div>
                  {expense.status === "PENDING" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <form action={approveExpenseAction}>
                        <input type="hidden" name="returnTo" value={`/utlegg/kontor?status=${status}`} />
                        <input type="hidden" name="id" value={expense.id} />
                        <button
                          className={buttonClassName({ variant: "primary", size: "sm" })}
                          type="submit"
                        >
                          {t("expenses.approve")}
                        </button>
                      </form>
                      <form action={rejectExpenseAction} className="flex flex-1 flex-wrap items-center gap-2">
                        <input type="hidden" name="returnTo" value={`/utlegg/kontor?status=${status}`} />
                        <input type="hidden" name="id" value={expense.id} />
                        <Input
                          name="reason"
                          placeholder={t("expenses.rejectReason")}
                          aria-label={t("expenses.rejectReason")}
                          required
                          className="min-w-40 flex-1"
                        />
                        <button
                          className={buttonClassName({ variant: "danger-outline", size: "sm" })}
                          type="submit"
                        >
                          {t("expenses.reject")}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card as="section" className="p-4 sm:p-5">
        <h2 className="type-eyebrow text-ink">{t("expenses.payroll.title")}</h2>
        <p className="mt-1 text-sm text-muted">
          {t("expenses.payroll.description")}
        </p>
        <form className="mt-3 flex flex-wrap items-end gap-2" method="get" action="/utlegg/kontor">
          <Field id="payroll-start" label={t("expenses.payroll.from")}>
            <Input id="payroll-start" type="date" name="start" defaultValue={start} />
          </Field>
          <Field id="payroll-end" label={t("expenses.payroll.to")}>
            <Input id="payroll-end" type="date" name="end" defaultValue={end} />
          </Field>
          <button
            className={buttonClassName({ variant: "secondary", size: "sm" })}
            type="submit"
          >
            {t("expenses.payroll.preview")}
          </button>
          <button
            className={buttonClassName({ variant: "primary", size: "sm" })}
            type="submit"
            formAction="/utlegg/kontor/eksport"
            formMethod="get"
          >
            {t("expenses.payroll.export")}
          </button>
        </form>

        {preview && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: t("expenses.payroll.workHours"), value: preview.totals.workHours },
              { label: t("expenses.payroll.travelHours"), value: preview.totals.travelHours },
              { label: t("expenses.payroll.mileageKm"), value: preview.totals.mileageKm },
              { label: t("expenses.payroll.mileageAmount"), value: money(preview.totals.mileageAmount, locale) },
              { label: t("expenses.payroll.expenseAmount"), value: money(preview.totals.expenseAmount, locale) },
              { label: t("expenses.payroll.rows"), value: preview.rows.length },
            ].map((stat) => (
              <p key={stat.label} className={`${brandInset} px-3 py-2 text-xs`}>
                <span className="type-eyebrow block text-muted">{stat.label}</span>
                <span className="text-base font-black tabular-nums">{stat.value}</span>
              </p>
            ))}
          </div>
        )}

        {exportHistory.length > 0 && (
          <div
            className="mt-4 overflow-x-auto"
            role="region"
            aria-label={t("expenses.payroll.title")}
            tabIndex={0}
          >
            <table className="office-table min-w-[32rem]">
              <thead>
                <tr>
                  <th scope="col">{t("expenses.payroll.period")}</th>
                  <th scope="col" className="text-right">{t("expenses.payroll.rows")}</th>
                  <th scope="col">{t("expenses.payroll.created")}</th>
                  <th scope="col">{t("expenses.payroll.checksum")}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {exportHistory.map((row) => (
                  <tr key={row.id}>
                    <td className="font-bold tabular-nums">
                      {row.periodStart} – {row.periodEnd}
                    </td>
                    <td className="text-right tabular-nums">{row.rowCount}</td>
                    <td className="text-xs">{formatDateTimeLocalized(row.createdAt, locale)}</td>
                    <td className="font-mono text-2xs">{row.checksum.slice(0, 12)}…</td>
                    <td className="text-right">
                      <a
                        className="text-xs font-bold underline"
                        href={`/utlegg/kontor/eksport?start=${row.periodStart}&end=${row.periodEnd}`}
                      >
                        {t("expenses.payroll.download")}
                      </a>
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
