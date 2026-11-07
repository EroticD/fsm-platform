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

const CARD = "office-card min-w-0 p-4 sm:p-5";
const LABEL =
  "text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const CONTROL =
  "min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]";
const SIGNAL_BUTTON =
  "signal-button inline-flex min-h-11 items-center justify-center px-4 text-sm";
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

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className={CARD}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className={LABEL}>{t("expenses.eyebrow")}</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
                {t("expenses.title")}
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-[var(--muted,#62685f)]">
                {t("expenses.description")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="rounded-xl border border-[var(--line,#dedcd1)] px-3 py-2">
                <p className={LABEL}>{t("expenses.totals.pending")}</p>
                <p className="font-black tabular-nums">{money(totals.pendingAmount, locale)}</p>
              </div>
              <div className="rounded-xl border border-[var(--line,#dedcd1)] px-3 py-2">
                <p className={LABEL}>{t("expenses.totals.approved")}</p>
                <p className="font-black tabular-nums">{money(totals.approvedAmount, locale)}</p>
              </div>
              <Link
                className={INK_BUTTON}
                href="/utlegg/kontor"
              >
                {t("expenses.officeLink")}
              </Link>
            </div>
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

        {workOrderId && (
          <div className="rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-4 py-3 text-sm font-bold">
            {t("expenses.linkedWorkOrder")}:{" "}
            <Link className="underline underline-offset-2" href={`/oppdrag/${workOrderId}`}>
              {workOrderId}
            </Link>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("expenses.trip.title")}
            </h2>
            <form action={createMileageTripAction} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="returnTo" value={workOrderId ? `/utlegg?oppdrag=${workOrderId}` : "/utlegg"} />
              <input type="hidden" name="workOrderId" value={workOrderId} />
              <input type="hidden" name="visitId" value={visitId} />
              <input type="hidden" name="submit" value="true" />
              <input className={CONTROL} name="date" type="date" defaultValue={today} required />
              <input className={CONTROL} name="km" type="number" step="0.01" min="0.01" placeholder={t("expenses.trip.km")} required />
              <input className={CONTROL} name="fromAddress" placeholder={t("expenses.trip.from")} required />
              <input className={CONTROL} name="toAddress" placeholder={t("expenses.trip.to")} required />
              <input className={CONTROL} name="rate" type="number" step="0.0001" min="0" defaultValue={DEFAULT_MILEAGE_RATE} placeholder={t("expenses.trip.rate")} />
              <input className={CONTROL} name="purpose" placeholder={t("expenses.trip.purpose")} />
              <button className={`${SIGNAL_BUTTON} sm:col-span-2`} type="submit">
                {t("expenses.trip.submit")}
              </button>
            </form>
          </section>

          <section className={CARD}>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">
              {t("expenses.expense.title")}
            </h2>
            <form action={createExpenseAction} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="returnTo" value={workOrderId ? `/utlegg?oppdrag=${workOrderId}` : "/utlegg"} />
              <input type="hidden" name="workOrderId" value={workOrderId} />
              <input type="hidden" name="visitId" value={visitId} />
              <input type="hidden" name="submit" value="true" />
              <input className={CONTROL} name="date" type="date" defaultValue={today} required />
              <input className={CONTROL} name="category" placeholder={t("expenses.expense.category")} required />
              <input className={CONTROL} name="amount" type="number" step="0.01" min="0.01" placeholder={t("expenses.expense.amount")} required />
              <input className={CONTROL} name="vatRate" type="number" step="0.01" min="0" max="100" defaultValue={DEFAULT_VAT_RATE} placeholder={t("expenses.expense.vatRate")} />
              <input className={`${CONTROL} sm:col-span-2`} name="description" placeholder={t("expenses.expense.description")} />
              <div className="sm:col-span-2">
                <ReceiptUploadField
                  workOrderId={workOrderId || undefined}
                  label={t("expenses.expense.receipt")}
                  uploadingLabel={t("expenses.expense.uploading")}
                  errorLabel={t("expenses.expense.uploadError")}
                />
              </div>
              <button className={`${SIGNAL_BUTTON} sm:col-span-2`} type="submit">
                {t("expenses.expense.submit")}
              </button>
            </form>
          </section>
        </div>

        <section className={CARD}>
          <h2 className="text-sm font-black uppercase tracking-[0.12em]">
            {t("expenses.trip.listTitle")}
          </h2>
          {trips.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted,#62685f)]">{t("expenses.trip.empty")}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("expenses.date")}</th>
                    <th className="px-2 py-2">{t("expenses.trip.route")}</th>
                    <th className="px-2 py-2 text-right">{t("expenses.trip.km")}</th>
                    <th className="px-2 py-2 text-right">{t("expenses.amount")}</th>
                    <th className="px-2 py-2">{t("expenses.statusLabel")}</th>
                    <th className="px-2 py-2">{t("expenses.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {trips.map((trip) => (
                    <tr key={trip.id} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2 tabular-nums">{trip.date}</td>
                      <td className="px-2 py-2">
                        {trip.fromAddress} → {trip.toAddress}
                        {trip.workOrderId && (
                          <Link className="ml-2 text-xs underline" href={`/oppdrag/${trip.workOrderId}`}>
                            {t("expenses.openWorkOrder")}
                          </Link>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{trip.km}</td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums">{money(trip.amount, locale)}</td>
                      <td className="px-2 py-2 text-xs font-bold">
                        {t(`expenses.status.${trip.status.toLowerCase()}`)}
                        {trip.rejectionReason && (
                          <span className="block font-normal text-[var(--risk-text,#b42318)]">
                            {trip.rejectionReason}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {trip.status === "DRAFT" && (
                          <form action={submitMileageTripAction}>
                            <input type="hidden" name="returnTo" value="/utlegg" />
                            <input type="hidden" name="id" value={trip.id} />
                            <button className={INK_BUTTON} type="submit">
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
        </section>

        <section className={CARD}>
          <h2 className="text-sm font-black uppercase tracking-[0.12em]">
            {t("expenses.expense.listTitle")}
          </h2>
          {expenses.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--muted,#62685f)]">{t("expenses.expense.empty")}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted,#62685f)]">
                    <th className="px-2 py-2">{t("expenses.date")}</th>
                    <th className="px-2 py-2">{t("expenses.expense.category")}</th>
                    <th className="px-2 py-2 text-right">{t("expenses.amount")}</th>
                    <th className="px-2 py-2 text-right">{t("expenses.vat")}</th>
                    <th className="px-2 py-2">{t("expenses.receipt")}</th>
                    <th className="px-2 py-2">{t("expenses.statusLabel")}</th>
                    <th className="px-2 py-2">{t("expenses.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id} className="border-t border-[var(--line,#dedcd1)]">
                      <td className="px-2 py-2 tabular-nums">{expense.date}</td>
                      <td className="px-2 py-2">
                        {expense.category}
                        {expense.description && (
                          <span className="block text-xs text-[var(--muted,#62685f)]">{expense.description}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums">{money(expense.amount, locale)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{money(expense.vatAmount, locale)}</td>
                      <td className="px-2 py-2 text-xs">
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
                      <td className="px-2 py-2 text-xs font-bold">
                        {t(`expenses.status.${expense.status.toLowerCase()}`)}
                        {expense.rejectionReason && (
                          <span className="block font-normal text-[var(--risk-text,#b42318)]">
                            {expense.rejectionReason}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {expense.status === "DRAFT" && (
                          <form action={submitExpenseAction}>
                            <input type="hidden" name="returnTo" value="/utlegg" />
                            <input type="hidden" name="id" value={expense.id} />
                            <button className={INK_BUTTON} type="submit">
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
        </section>
      </div>
    </div>
  );
}
