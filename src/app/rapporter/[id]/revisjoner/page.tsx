import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { formatDate, formatDateTime } from "@/lib/dates";
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
              <span className="font-bold text-gray-900">{key}: </span>
              <span className="text-gray-800">{String(value)}</span>
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
              <span className="font-bold text-gray-900">{label}: </span>
              {type === "TEXT" || type === "TEXTAREA" ? (
                typeof answer === "string" && answer.trim() ? (
                  <div className="mt-1 border-l-2 border-gray-200 pl-2">
                    <MarkdownView value={answer} size="sm" />
                  </div>
                ) : (
                  <span className="text-gray-400">{notAnswered}</span>
                )
              ) : (
                <span className="text-gray-800">{rendered}</span>
              )}
            </div>
            {comment && (
              <div className="rounded-r border-l-4 border-amber-300 bg-amber-50 px-2 py-1 text-[13px] text-amber-900">
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
  const fields = revisionFields(revision);
  const status = revisionStatus(revision);
  const legacyAnswers = revisionLegacyAnswers(revision);
  const technicianSignature = safeImageSrc(revision.technicianSignatureUrl);
  const customerSignature = safeImageSrc(revision.customerSignatureUrl);

  return (
    <div className="space-y-4 rounded-2xl border-2 border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-3">
        <div>
          <h2 className="text-lg font-black text-gray-900">
            {t("orders.revisions.snapshotTitle", {
              revision: revision.revision,
            })}
          </h2>
          <p className="text-xs text-gray-500">
            {reportName}
            {revision.completedAt
              ? ` · ${formatDate(revision.completedAt)}`
              : ""}
          </p>
        </div>
        <a
          href={`/api/rapporter/revisjoner/${revision.id}/pdf?download=1`}
          className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
        >
          {t("orders.revisions.downloadPdf")}
        </a>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-gray-50 p-3 text-sm">
          <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">
            {t("orders.revisions.reason")}
          </p>
          <p className="mt-1 font-bold text-gray-900">
            {revision.reason || t("orders.revisions.noReason")}
          </p>
          {revision.reportNumber && (
            <p className="mt-1 text-xs text-gray-600">
              {t("orders.revisions.reportNumber")}:{" "}
              <span className="font-bold text-gray-900">{revision.reportNumber}</span>
            </p>
          )}
          <p className="mt-1 text-xs text-gray-600">
            {t("orders.revisions.actor")}:{" "}
            {revision.actorName || t("orders.revisions.unknownActor")}
          </p>
          <p className="text-xs text-gray-600">
            {t("orders.revisions.createdAt")}:{" "}
            {formatDateTime(revision.createdAt)}
          </p>
        </div>
        <div className="rounded-xl bg-gray-50 p-3 text-sm">
          {revision.requiresUnits && (
            <>
              <p className="text-[10px] font-black uppercase tracking-wider text-gray-500">
                {t("orders.revisions.status")}
              </p>
              <p
                className={`mt-1 font-black ${
                  status === "AVVIK" ? "text-red-800" : "text-green-800"
                }`}
              >
                {status === "AVVIK"
                  ? t("orders.detail.report.deviation")
                  : t("orders.detail.report.approved")}
              </p>
            </>
          )}
          <p className={`text-xs text-gray-600 ${revision.requiresUnits ? "mt-1" : ""}`}>
            {revision.requiresUnits
              ? t("orders.revisions.unitSummary", {
                  count: revision.unitCount,
                  deviations: revision.deviationCount,
                })
              : t("orders.revisions.noUnits")}
          </p>
          {revision.customerAcknowledgedAt && (
            <p className="mt-1 text-xs text-green-800">
              ✓{" "}
              {t("p3.portalReports.acknowledged", {
                date: formatDate(revision.customerAcknowledgedAt),
              })}
              {revision.customerAcknowledgedBy
                ? ` · ${revision.customerAcknowledgedBy}`
                : ""}
            </p>
          )}
        </div>
      </div>

      {revision.requiresUnits ? (
        <div className="space-y-3">
          {revision.units.map((unit, index) => {
            let answers: Record<string, unknown> = {};
            try {
              answers = JSON.parse(unit.answersJson || "{}");
            } catch {}
            return (
              <div
                key={unit.id}
                className="overflow-hidden rounded-xl border-2 border-gray-200"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-gray-200 bg-gray-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-black text-gray-900">
                      {index + 1}. {unit.label || t("orders.revisions.noUnitLabel")}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {unit.serialNumber || t("orders.detail.report.noSerialNumber")}
                      {unit.location ? ` · ${unit.location}` : ""}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
                      unit.status === "AVVIK"
                        ? "border-red-200 bg-red-100 text-red-800"
                        : "border-green-200 bg-green-100 text-green-800"
                    }`}
                  >
                    {unit.status === "AVVIK"
                      ? t("orders.detail.report.deviationShort")
                      : t("orders.detail.report.approvedShort")}
                  </span>
                </div>
                <div className="space-y-2 p-3">
                  <FieldRows
                    fields={fields}
                    answers={answers}
                    notAnswered={t("orders.detail.report.notAnswered")}
                    yes={t("orders.detail.report.yesDone")}
                    no={t("orders.detail.report.noUnchecked")}
                  />
                </div>
                {unit.comment && (
                  <div className="border-t-2 border-gray-200 bg-gray-50 px-3 py-2">
                    <MarkdownView value={unit.comment} size="sm" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border-2 border-gray-200 bg-gray-50 p-3">
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
        <div className="grid grid-cols-1 gap-3 border-t-2 border-gray-200 pt-3 sm:grid-cols-2">
          <div className="rounded-xl border-2 border-gray-200 bg-gray-50 p-3">
            <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-gray-500">
              {t("orders.detail.report.technicianSignature")}
            </p>
            {technicianSignature && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={technicianSignature}
                alt={t("orders.detail.report.technicianSignature")}
                className="h-20 rounded border border-gray-200 bg-white"
              />
            )}
            <p className="mt-1 text-sm font-bold text-gray-900">
              {revision.technicianName || t("orders.detail.report.noName")}
            </p>
          </div>
          <div className="rounded-xl border-2 border-gray-200 bg-gray-50 p-3">
            <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-gray-500">
              {t("orders.detail.report.customerSignature")}
            </p>
            {customerSignature && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={customerSignature}
                alt={t("orders.detail.report.customerSignature")}
                className="h-20 rounded border border-gray-200 bg-white"
              />
            )}
            <p className="mt-1 text-sm font-bold text-gray-900">
              {revision.customerName || t("orders.detail.report.noName")}
            </p>
          </div>
        </div>
      )}

      {revision.comments && (
        <div className="border-t-2 border-gray-200 pt-3">
          <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-gray-500">
            {t("orders.detail.report.generalNotes")}
          </p>
          <MarkdownView value={revision.comments} />
        </div>
      )}
    </div>
  );
}

export default async function ReportRevisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rapport?: string; revisjon?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user?.isActive) redirect("/logg-inn");

  const t = await getTranslations("common");
  const { id } = await params;
  const query = await searchParams;

  const overview = await getWorkOrderRevisionOverview(user, id);
  if (!overview.ok) {
    if (overview.error === "forbidden") {
      redirect(user.role === "CUSTOMER" ? "/kundeportal" : "/rapporter");
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 p-8 text-center">
        <p className="font-medium text-gray-600">
          {t("orders.revisions.notFound")}
        </p>
        <Link
          href={user.role === "CUSTOMER" ? "/kundeportal" : "/rapporter"}
          className="rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-bold text-white"
        >
          {t("orders.detail.back")}
        </Link>
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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex flex-col justify-between gap-4 border-b border-gray-300 pb-4 md:flex-row md:items-center">
          <div>
            <h1 className="text-2xl font-black text-gray-900 md:text-3xl">
              🕘 {t("orders.revisions.title")}
            </h1>
            <p className="mt-1 text-sm font-medium text-gray-500">
              {workOrder.title}
              {workOrder.orderNumber
                ? ` · ${t("orders.detail.orderNumber")}: ${workOrder.orderNumber}`
                : ""}
              {workOrder.customerName ? ` · ${workOrder.customerName}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/rapporter/${workOrder.id}`}
              className="rounded-xl border-2 border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-100"
            >
              {t("orders.revisions.openCurrentPdf")}
            </Link>
            <Link
              href={user.role === "CUSTOMER" ? "/kundeportal" : "/rapporter"}
              className="rounded-xl border-2 border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-100"
            >
              ← {t("orders.revisions.back")}
            </Link>
          </div>
        </div>

        {reports.length === 0 && (
          <p className="rounded-2xl border-2 border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-600">
            {t("orders.revisions.noReports")}
          </p>
        )}

        {reports.map(({ report, revisions }) => {
          const active = selectedReport?.report.id === report.id;
          const name =
            report.name || report.templateTitle || t("orders.revisions.defaultName");
          return (
            <section
              key={report.id}
              className={`rounded-2xl border-2 bg-white p-4 shadow-sm ${
                active ? "border-blue-300" : "border-gray-200"
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-2">
                <div>
                  <h2 className="font-black text-gray-900">{name}</h2>
                  <p className="text-[11px] text-gray-500">
                    {t("orders.revisions.currentRevision", {
                      revision: report.revision,
                    })}
                    {report.legalHold
                      ? ` · ${t("orders.detail.legalHoldBadge")}`
                      : ""}
                  </p>
                </div>
                {revisions.length === 0 && (
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[11px] font-bold text-gray-600">
                    {t("orders.revisions.noRevisions")}
                  </span>
                )}
              </div>

              {revisions.length > 0 && (
                <ul className="space-y-2">
                  {revisions.map((revision) => {
                    const selected =
                      active && revision.id === selectedRevisionId;
                    return (
                      <li key={revision.id}>
                        <Link
                          href={`/rapporter/${workOrder.id}/revisjoner?rapport=${report.id}&revisjon=${revision.id}`}
                          className={`block rounded-xl border-2 p-3 transition ${
                            selected
                              ? "border-blue-400 bg-blue-50"
                              : "border-gray-200 bg-gray-50 hover:border-blue-300"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold text-gray-900">
                              {t("orders.revisions.revisionLabel", {
                                revision: revision.revision,
                              })}
                              {revision.reason ? ` – ${revision.reason}` : ""}
                            </span>
                            <span className="text-[11px] font-bold text-gray-500">
                              {formatDateTime(revision.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-gray-600">
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
          <p className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
            {t("orders.revisions.snapshotMissing")}
          </p>
        )}
      </div>
    </div>
  );
}
