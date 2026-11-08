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

const CARD = "office-card min-w-0 p-4 sm:p-5";
const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const CONTROL =
  "min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]";
const SIGNAL_BUTTON =
  "signal-button inline-flex min-h-10 items-center justify-center px-3 text-xs font-bold";
const INK_BUTTON =
  "inline-flex min-h-10 items-center justify-center rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";

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
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className={CARD}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className={LABEL}>{t("expenses.eyebrow")}</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
                {t("expenses.office.title")}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-[var(--muted,#62685f)]">
                {t("expenses.office.description")}
              </p>
            </div>
            <Link className={INK_BUTTON} href="/utlegg">
              {t("expenses.office.myExpenses")}
            </Link>
          </div>
        </header>

        {meldt && (
          <div className="rounded-lg border border-[#a9c96a] bg-[#eef7d6] px-4 py-3 text-sm font-bold text-[#283509]">
            {t("expenses.feedback.saved")}
          </div>
        )}
        {feil && (
          <div className="rounded-lg border border-[#e7b5ae] bg-[#fbe9e7] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]">
            {t("expenses.feedback.error")}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {["PENDING", "APPROVED", "REJECTED"].map((value) => (
            <Link
              key={value}
              href={`/utlegg/kontor?status=${value}`}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                status === value
                  ? "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                  : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)]"
              }`}
            >
              {t(`expenses.status.${value.toLowerCase()}`)}
            </Link>
          ))}
        </div>

        <div className="rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-4 py-3 text-sm font-bold">
          {t("expenses.office.pendingSummary", {
            count: totals.pendingCount,
            amount: money(totals.pendingAmount, locale),
          })}
        </div>

        <div data-expense-approval className="space-y-4">
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("expenses.trip.approvalTitle")}
          </h2>
          {trips.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted,#62685f)]">{t("expenses.office.empty")}</p>
          ) : (
            <div className="mt-3 space-y-3">
              {trips.map((trip) => (
                <div key={trip.id} className="rounded-xl border border-[var(--line,#dedcd1)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 text-sm">
                      <p className="font-bold">
                        {trip.userName} · {trip.date}
                      </p>
                      <p>{trip.fromAddress} → {trip.toAddress}</p>
                      <p className="text-xs text-[var(--muted,#62685f)]">
                        {trip.km} km × {trip.rate} kr = {money(trip.amount, locale)}
                        {trip.purpose ? ` · ${trip.purpose}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full border border-[var(--line,#dedcd1)] px-2.5 py-1 text-xs font-bold">
                      {t(`expenses.status.${trip.status.toLowerCase()}`)}
                    </span>
                  </div>
                  {trip.status === "PENDING" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <form action={approveMileageTripAction}>
                        <input type="hidden" name="returnTo" value={`/utlegg/kontor?status=${status}`} />
                        <input type="hidden" name="id" value={trip.id} />
                        <button className={SIGNAL_BUTTON} type="submit">
                          {t("expenses.approve")}
                        </button>
                      </form>
                      <form action={rejectMileageTripAction} className="flex flex-1 flex-wrap items-center gap-2">
                        <input type="hidden" name="returnTo" value={`/utlegg/kontor?status=${status}`} />
                        <input type="hidden" name="id" value={trip.id} />
                        <input className={`${CONTROL} min-w-40 flex-1`} name="reason" placeholder={t("expenses.rejectReason")} required />
                        <button className={INK_BUTTON} type="submit">
                          {t("expenses.reject")}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={CARD}>
          <h2 className="text-sm font-black uppercase tracking-[0.12em]">
            {t("expenses.expense.approvalTitle")}
          </h2>
          {expenses.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted,#62685f)]">{t("expenses.office.empty")}</p>
          ) : (
            <div className="mt-3 space-y-3">
              {expenses.map((expense) => (
                <div key={expense.id} className="rounded-xl border border-[var(--line,#dedcd1)] p-3">
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
                        <p className="text-xs text-[var(--muted,#62685f)]">{expense.description}</p>
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
                    <span className="rounded-full border border-[var(--line,#dedcd1)] px-2.5 py-1 text-xs font-bold">
                      {t(`expenses.status.${expense.status.toLowerCase()}`)}
                    </span>
                  </div>
                  {expense.status === "PENDING" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <form action={approveExpenseAction}>
                        <input type="hidden" name="returnTo" value={`/utlegg/kontor?status=${status}`} />
                        <input type="hidden" name="id" value={expense.id} />
                        <button className={SIGNAL_BUTTON} type="submit">
                          {t("expenses.approve")}
                        </button>
                      </form>
                      <form action={rejectExpenseAction} className="flex flex-1 flex-wrap items-center gap-2">
                        <input type="hidden" name="returnTo" value={`/utlegg/kontor?status=${status}`} />
                        <input type="hidden" name="id" value={expense.id} />
                        <input className={`${CONTROL} min-w-40 flex-1`} name="reason" placeholder={t("expenses.rejectReason")} required />
                        <button className={INK_BUTTON} type="submit">
                          {t("expenses.reject")}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          </section>
        </div>

        <section className={CARD}>
          <h2 className="text-sm font-black uppercase tracking-[0.12em]">
            {t("expenses.payroll.title")}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
            {t("expenses.payroll.description")}
          </p>
          <form className="mt-3 flex flex-wrap items-end gap-2" method="get" action="/utlegg/kontor">
            <label className="text-xs font-bold">
              {t("expenses.payroll.from")}
              <input className={`${CONTROL} mt-1`} type="date" name="start" defaultValue={start} />
            </label>
            <label className="text-xs font-bold">
              {t("expenses.payroll.to")}
              <input className={`${CONTROL} mt-1`} type="date" name="end" defaultValue={end} />
            </label>
            <button className={INK_BUTTON} type="submit">
              {t("expenses.payroll.preview")}
            </button>
            <button
              className={SIGNAL_BUTTON}
              type="submit"
              formAction="/utlegg/kontor/eksport"
              formMethod="get"
            >
              {t("expenses.payroll.export")}
            </button>
          </form>

          {preview && (
            <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <p className="rounded-lg border border-[var(--line,#dedcd1)] px-3 py-2 text-xs">
                <span className={`${LABEL} block`}>{t("expenses.payroll.workHours")}</span>
                <span className="text-base font-black tabular-nums">{preview.totals.workHours}</span>
              </p>
              <p className="rounded-lg border border-[var(--line,#dedcd1)] px-3 py-2 text-xs">
                <span className={`${LABEL} block`}>{t("expenses.payroll.travelHours")}</span>
                <span className="text-base font-black tabular-nums">{preview.totals.travelHours}</span>
              </p>
              <p className="rounded-lg border border-[var(--line,#dedcd1)] px-3 py-2 text-xs">
                <span className={`${LABEL} block`}>{t("expenses.payroll.mileageKm")}</span>
                <span className="text-base font-black tabular-nums">{preview.totals.mileageKm}</span>
              </p>
              <p className="rounded-lg border border-[var(--line,#dedcd1)] px-3 py-2 text-xs">
                <span className={`${LABEL} block`}>{t("expenses.payroll.mileageAmount")}</span>
                <span className="text-base font-black tabular-nums">{money(preview.totals.mileageAmount, locale)}</span>
              </p>
              <p className="rounded-lg border border-[var(--line,#dedcd1)] px-3 py-2 text-xs">
                <span className={`${LABEL} block`}>{t("expenses.payroll.expenseAmount")}</span>
                <span className="text-base font-black tabular-nums">{money(preview.totals.expenseAmount, locale)}</span>
              </p>
              <p className="rounded-lg border border-[var(--line,#dedcd1)] px-3 py-2 text-xs">
                <span className={`${LABEL} block`}>{t("expenses.payroll.rows")}</span>
                <span className="text-base font-black tabular-nums">{preview.rows.length}</span>
              </p>
            </div>
          )}

          {exportHistory.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("expenses.payroll.period")}</th>
                    <th className="px-2 py-2 text-right">{t("expenses.payroll.rows")}</th>
                    <th className="px-2 py-2">{t("expenses.payroll.created")}</th>
                    <th className="px-2 py-2">{t("expenses.payroll.checksum")}</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {exportHistory.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2 font-bold tabular-nums">
                        {row.periodStart} – {row.periodEnd}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.rowCount}</td>
                      <td className="px-2 py-2 text-xs">{formatDateTimeLocalized(row.createdAt, locale)}</td>
                      <td className="px-2 py-2 font-mono text-2xs">{row.checksum.slice(0, 12)}…</td>
                      <td className="px-2 py-2 text-right">
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
        </section>
      </div>
    </div>
  );
}
