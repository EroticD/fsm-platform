import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { formatDateLocalized, formatDateTimeLocalized } from "@/lib/dates";
import { isLineCommentKey, readLineComment } from "@/lib/report-answers";
import {
  revisionFields,
  revisionLegacyAnswers,
  revisionStatus,
} from "@/lib/report-revision";
import {
  getReportRevision,
  getWorkOrderRevisionOverview,
  type ReportRevisionSnapshot,
} from "@/server/report-revisions";
import MarkdownView from "@/components/MarkdownView";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";

const CARD = "office-card";
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const INK_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const EYEBROW =
  "text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const MUTED = "text-[var(--muted,#62685f)]";
const INSET =
  "rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3";

function safeImageSrc(url: string | null | undefined): string | null {
  const value = (url ?? "").trim();
  if (value.startsWith("/uploads/")) return value;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) return value;
  return null;
}

function FieldRows({
  fields,
  answers,
  notAnswered,
  yes,
  no,
}: {
  fields: Array<Record<string, unknown>>;
  answers: Record<string, unknown>;
  notAnswered: string;
  yes: string;
  no: string;
}) {
  if (fields.length === 0) {
    return (
      <>
        {Object.entries(answers)
          .filter(([key]) => !isLineCommentKey(key))
          .map(([key, value]) => (
            <div key={key} className="text-sm">
              <span className="font-bold text-[var(--ink,#101310)]">{key}: </span>
              <span className={MUTED}>{String(value)}</span>
            </div>
          ))}
      </>
    );
  }

  return (
    <>
      {fields.map((field) => {
        const id = typeof field.id === "string" ? field.id : "";
        const label = typeof field.label === "string" ? field.label : id;
        const type = typeof field.type === "string" ? field.type : "";
        const answer = answers[id];
        const comment = id ? readLineComment(answers, id) : "";

        let rendered: string;
        if (type === "CHECKBOX") rendered = answer ? yes : no;
        else if (answer === undefined || answer === null || answer === "")
          rendered = notAnswered;
        else rendered = String(answer);

        return (
          <div key={id} className="space-y-1 text-sm">
            <div>
              <span className="font-bold text-[var(--ink,#101310)]">{label}: </span>
              {type === "TEXT" || type === "TEXTAREA" ? (
                typeof answer === "string" && answer.trim() ? (
                  <div className="mt-1 border-l-2 border-[var(--line,#dedcd1)] pl-2">
                    <MarkdownView value={answer} size="sm" />
                  </div>
                ) : (
                  <span className={MUTED}>{notAnswered}</span>
                )
              ) : (
                <span className="text-[#3d4237]">{rendered}</span>
              )}
            </div>
            {comment && (
              <div className="rounded-r border-l-2 border-[#c9a24a] bg-[#fbf7e8] px-2 py-1 text-[13px] text-[#5f4a14]">
                <MarkdownView value={comment} size="xs" />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

async function RevisionSnapshot({
  revision,
  reportName,
}: {
  revision: ReportRevisionSnapshot;
  reportName: string;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const fields = revisionFields(revision);
  const status = revisionStatus(revision);
  const legacyAnswers = revisionLegacyAnswers(revision);
  const technicianSignature = safeImageSrc(revision.technicianSignatureUrl);
  const customerSignature = safeImageSrc(revision.customerSignatureUrl);

  return (
    <section className={`${CARD} relative space-y-4 overflow-hidden p-4 sm:p-5`}>
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 bg-[var(--signal,#d8ff3e)]"
      />
      <div className="flex flex-col gap-3 border-b border-[var(--line,#dedcd1)] pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]">
            <Icon name="clock" className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
              {t("orders.revisions.snapshotTitle", {
                revision: revision.revision,
              })}
            </h2>
            <p className={`text-xs ${MUTED}`}>
              {reportName}
              {revision.completedAt
                ? ` · ${formatDateLocalized(revision.completedAt, locale)}`
                : ""}
            </p>
          </div>
        </div>
        <a
          href={`/api/rapporter/revisjoner/${revision.id}/pdf?download=1`}
          className={`${SIGNAL_BUTTON} shrink-0`}
        >
          <Icon name="arrowRight" className="h-4 w-4 shrink-0 rotate-90" />
          {t("orders.revisions.downloadPdf")}
        </a>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className={INSET}>
          <p className={EYEBROW}>{t("orders.revisions.reason")}</p>
          <p className="mt-1 text-sm font-bold text-[var(--ink,#101310)]">
            {revision.reason || t("orders.revisions.noReason")}
          </p>
          {revision.reportNumber && (
            <p className={`mt-1 text-xs ${MUTED}`}>
              {t("orders.revisions.reportNumber")}:{" "}
              <span className="font-mono font-bold text-[var(--ink,#101310)]">
                {revision.reportNumber}
              </span>
            </p>
          )}
          <p className={`mt-1 text-xs ${MUTED}`}>
            {t("orders.revisions.actor")}:{" "}
            <span className="font-bold text-[var(--ink,#101310)]">
              {revision.actorName || t("orders.revisions.unknownActor")}
            </span>
          </p>
          <p className={`mt-1 font-mono text-xs ${MUTED}`}>
            {t("orders.revisions.createdAt")}:{" "}
            {formatDateTimeLocalized(revision.createdAt, locale)}
          </p>
        </div>
        <div className={INSET}>
          {revision.requiresUnits && (
            <>
              <p className={EYEBROW}>{t("orders.revisions.status")}</p>
              <p className="mt-1">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${
                    status === "AVVIK"
                      ? "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]"
                      : "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                  }`}
                >
                  <Icon
                    name={status === "AVVIK" ? "alert" : "check"}
                    className="h-3 w-3 shrink-0"
                  />
                  {status === "AVVIK"
                    ? t("orders.detail.report.deviation")
                    : t("orders.detail.report.approved")}
                </span>
              </p>
            </>
          )}
          <p className={`text-xs ${MUTED} ${revision.requiresUnits ? "mt-1" : ""}`}>
            {revision.requiresUnits
              ? t("orders.revisions.unitSummary", {
                  count: revision.unitCount,
                  deviations: revision.deviationCount,
                })
              : t("orders.revisions.noUnits")}
          </p>
          {revision.customerAcknowledgedAt && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold text-[var(--ink,#101310)]">
              <Icon name="check" className="h-3.5 w-3.5 shrink-0" />
              {t("p3.portalReports.acknowledged", {
                date: formatDateLocalized(
                  revision.customerAcknowledgedAt,
                  locale,
                ),
              })}
              {revision.customerAcknowledgedBy
                ? ` · ${revision.customerAcknowledgedBy}`
                : ""}
            </p>
          )}
        </div>
      </div>

      {revision.requiresUnits ? (
        <div className="space-y-2">
          {revision.units.map((unit, index) => {
            let answers: Record<string, unknown> = {};
            try {
              answers = JSON.parse(unit.answersJson || "{}");
            } catch {}
            return (
              <div
                key={unit.id}
                className="overflow-hidden rounded-xl border border-[var(--line,#dedcd1)]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--ink,#101310)]">
                      <Icon name="wrench" className="h-3.5 w-3.5 shrink-0" />
                      {index + 1}.{" "}
                      {unit.label || t("orders.revisions.noUnitLabel")}
                    </p>
                    <p className={`mt-0.5 font-mono text-xs ${MUTED}`}>
                      {unit.serialNumber ||
                        t("orders.detail.report.noSerialNumber")}
                      {unit.location ? ` · ${unit.location}` : ""}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                      unit.status === "AVVIK"
                        ? "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]"
                        : "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                    }`}
                  >
                    <Icon
                      name={unit.status === "AVVIK" ? "alert" : "check"}
                      className="h-3 w-3 shrink-0"
                    />
                    {unit.status === "AVVIK"
                      ? t("orders.detail.report.deviationShort")
                      : t("orders.detail.report.approvedShort")}
                  </span>
                </div>
                <div className="space-y-2 bg-white p-3">
                  <FieldRows
                    fields={fields}
                    answers={answers}
                    notAnswered={t("orders.detail.report.notAnswered")}
                    yes={t("orders.detail.report.yesDone")}
                    no={t("orders.detail.report.noUnchecked")}
                  />
                </div>
                {unit.comment && (
                  <div className="border-t border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2">
                    <MarkdownView value={unit.comment} size="sm" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
          <FieldRows
            fields={fields}
            answers={
              revision.units[0]
                ? (() => {
                    try {
                      return JSON.parse(
                        revision.units[0].answersJson || "{}",
                      ) as Record<string, unknown>;
                    } catch {
                      return legacyAnswers;
                    }
                  })()
                : legacyAnswers
            }
            notAnswered={t("orders.detail.report.notAnswered")}
            yes={t("orders.detail.report.yesDone")}
            no={t("orders.detail.report.noUnchecked")}
          />
          {revision.units[0]?.comment && (
            <MarkdownView value={revision.units[0].comment} size="sm" />
          )}
        </div>
      )}

      {(technicianSignature || customerSignature) && (
        <div className="grid grid-cols-1 gap-2 border-t border-[var(--line,#dedcd1)] pt-3 sm:grid-cols-2">
          <div className={INSET}>
            <p className={`mb-1 ${EYEBROW}`}>
              {t("orders.detail.report.technicianSignature")}
            </p>
            {technicianSignature && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={technicianSignature}
                alt={t("orders.detail.report.technicianSignature")}
                className="h-20 rounded border border-[var(--line,#dedcd1)] bg-white"
              />
            )}
            <p className="mt-1 text-sm font-bold text-[var(--ink,#101310)]">
              {revision.technicianName || t("orders.detail.report.noName")}
            </p>
          </div>
          <div className={INSET}>
            <p className={`mb-1 ${EYEBROW}`}>
              {t("orders.detail.report.customerSignature")}
            </p>
            {customerSignature && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={customerSignature}
                alt={t("orders.detail.report.customerSignature")}
                className="h-20 rounded border border-[var(--line,#dedcd1)] bg-white"
              />
            )}
            <p className="mt-1 text-sm font-bold text-[var(--ink,#101310)]">
              {revision.customerName || t("orders.detail.report.noName")}
            </p>
          </div>
        </div>
      )}

      {revision.comments && (
        <div className="border-t border-[var(--line,#dedcd1)] pt-3">
          <p className={`mb-1 ${EYEBROW}`}>
            {t("orders.detail.report.generalNotes")}
          </p>
          <MarkdownView value={revision.comments} />
        </div>
      )}
    </section>
  );
}

export default async function ReportRevisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rapport?: string; revisjon?: string; returnTo?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user?.isActive) redirect("/logg-inn");

  const t = await getTranslations("common");
  const locale = await getLocale();
  const { id } = await params;
  const query = await searchParams;
  const returnTo = (() => {
    const raw = String(query.returnTo ?? "").trim();
    if (!raw || raw.length > 1000) return null;
    if (raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return null;
    if (!raw.startsWith("/") || raw.startsWith("//")) return null;
    return raw;
  })();
  const backHref =
    returnTo ?? (user.role === "CUSTOMER" ? "/kundeportal" : "/rapporter");
  const withReturnTo = (href: string) =>
    returnTo
      ? `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`
      : href;

  const overview = await getWorkOrderRevisionOverview(user, id);
  if (!overview.ok) {
    if (overview.error === "forbidden") {
      redirect(user.role === "CUSTOMER" ? "/kundeportal" : "/rapporter");
    }
    return (
      <div className="office-app flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className={`${CARD} max-w-md p-6`}>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]">
            <Icon name="clock" className="h-5 w-5" />
          </span>
          <p className={`mt-3 text-sm font-bold ${MUTED}`}>
            {t("orders.revisions.notFound")}
          </p>
          <Link
            href={user.role === "CUSTOMER" ? "/kundeportal" : "/rapporter"}
            className={`${INK_BUTTON} mt-4`}
          >
            {t("orders.detail.back")}
          </Link>
        </div>
      </div>
    );
  }

  const { workOrder, reports } = overview.data;
  const selectedReport =
    reports.find((entry) => entry.report.id === query.rapport) ??
    reports.find((entry) => entry.revisions.length > 0) ??
    reports[0] ??
    null;
  const selectedRevisionId =
    selectedReport?.revisions.find((revision) => revision.id === query.revisjon)
      ?.id ?? selectedReport?.revisions[0]?.id ?? null;

  const snapshot =
    selectedReport && selectedRevisionId
      ? await getReportRevision(user, selectedReport.report.id, selectedRevisionId)
      : null;
  const selectedName = selectedReport
    ? selectedReport.report.name ||
      selectedReport.report.templateTitle ||
      workOrder.title
    : "";

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader
          title={t("orders.revisions.title")}
          subtitle={
            <>
              {workOrder.title}
              {workOrder.orderNumber
                ? ` · ${t("orders.detail.orderNumber")}: ${workOrder.orderNumber}`
                : ""}
              {workOrder.customerName ? ` · ${workOrder.customerName}` : ""}
            </>
          }
          icon={<Icon name="clock" className="h-5 w-5" />}
          actions={
            <>
              <Link
                href={withReturnTo(
                  selectedReport
                    ? `/rapporter/${workOrder.id}?rapport=${selectedReport.report.id}`
                    : `/rapporter/${workOrder.id}`,
                )}
                className={INK_BUTTON}
              >
                <Icon name="file" className="h-4 w-4 shrink-0" />
                {t("orders.revisions.openCurrentPdf")}
              </Link>
              <Link href={backHref} className={INK_BUTTON}>
                <Icon
                  name="arrowRight"
                  className="h-4 w-4 shrink-0 rotate-180"
                />
                {t("orders.revisions.back")}
              </Link>
            </>
          }
        />

        {reports.length === 0 && (
          <p className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-6 text-center text-sm font-bold text-[var(--muted,#62685f)]">
            {t("orders.revisions.noReports")}
          </p>
        )}

        {reports.map(({ report, revisions }) => {
          const active = selectedReport?.report.id === report.id;
          const name =
            report.name ||
            report.templateTitle ||
            t("orders.revisions.defaultName");
          return (
            <section
              key={report.id}
              className={`${CARD} relative overflow-hidden p-3 transition sm:p-4 ${
                active
                  ? "border-[var(--ink,#101310)] shadow-[0_2px_0_var(--signal,#d8ff3e)]"
                  : ""
              }`}
            >
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-1 bg-[var(--signal,#d8ff3e)]"
                />
              )}
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-1.5 text-sm font-extrabold text-[var(--ink,#101310)]">
                    <Icon name="file" className="h-4 w-4 shrink-0" />
                    {name}
                  </h2>
                  <p className={`mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs ${MUTED}`}>
                    <span>
                      {t("orders.revisions.currentRevision", {
                        revision: report.revision,
                      })}
                    </span>
                    {report.reportNumber && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="font-mono">
                          {t("orders.revisions.reportNumber")}:{" "}
                          {report.reportNumber}
                        </span>
                      </>
                    )}
                    {report.legalHold && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#dfc98b] bg-[#fdf5e4] px-2 py-0.5 font-bold text-[#6b4808]">
                          <Icon name="shield" className="h-3 w-3 shrink-0" />
                          {t("orders.detail.legalHoldBadge")}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                {revisions.length === 0 && (
                  <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2.5 py-1 text-xs font-bold text-[var(--muted,#62685f)]">
                    {t("orders.revisions.noRevisions")}
                  </span>
                )}
              </div>

              {revisions.length > 0 && (
                <ul className="space-y-1.5">
                  {revisions.map((revision) => {
                    const selected =
                      active && revision.id === selectedRevisionId;
                    return (
                      <li key={revision.id}>
                        <Link
                          href={withReturnTo(
                            `/rapporter/${workOrder.id}/revisjoner?rapport=${report.id}&revisjon=${revision.id}`,
                          )}
                          className={`block rounded-lg border p-2.5 transition ${
                            selected
                              ? "border-[var(--ink,#101310)] bg-[#f8fce4]"
                              : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] hover:border-[var(--ink,#101310)]"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--ink,#101310)]">
                              <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
                              {t("orders.revisions.revisionLabel", {
                                revision: revision.revision,
                              })}
                              {revision.reason ? ` – ${revision.reason}` : ""}
                            </span>
                            <span className={`font-mono text-xs tabular-nums ${MUTED}`}>
                              {formatDateTimeLocalized(revision.createdAt, locale)}
                            </span>
                          </div>
                          <p className={`mt-0.5 text-xs ${MUTED}`}>
                            {t("orders.revisions.actor")}:{" "}
                            {revision.actorName ||
                              t("orders.revisions.unknownActor")}
                            {revision.requiresUnits
                              ? ` · ${t("orders.revisions.unitSummary", {
                                  count: revision.unitCount,
                                  deviations: revision.deviationCount,
                                })}`
                              : ` · ${t("orders.revisions.noUnits")}`}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        {snapshot?.ok && (
          <RevisionSnapshot
            revision={snapshot.data}
            reportName={selectedName}
          />
        )}
        {snapshot && !snapshot.ok && (
          <p className="rounded-xl border border-[#e7b5ae] bg-[#fbe9e7] p-4 text-sm font-bold text-[var(--risk-text,#b42318)]">
            {t("orders.revisions.snapshotMissing")}
          </p>
        )}
      </div>
    </div>
  );
}
