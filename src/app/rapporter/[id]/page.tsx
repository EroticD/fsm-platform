import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { canAccessReportWorkOrder } from "@/lib/report-scope";
import { formatDateLocalized } from "@/lib/dates";
import Icon from "@/components/icons";
import {
  reportAcknowledgement,
  reportUnitSummary,
} from "@/lib/report-display";

const CARD = "office-card";
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const INK_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const MUTED = "text-[var(--muted,#62685f)]";

/** Bare interne stier godtas som «tilbake»-mål. */
function safeReturnTo(value: string | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 1000) return null;
  if (raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

export default async function ReportViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rapport?: string; returnTo?: string }>;
}) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const viewer = await getCurrentUser();
  if (!viewer?.isActive) redirect("/logg-inn");

  const resolvedParams = await params;
  const query = await searchParams;

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: resolvedParams.id, deletedAt: null },
    select: {
      id: true,
      title: true,
      orderNumber: true,
      customerId: true,
      departmentId: true,
      department: { select: { isActive: true } },
      status: true,
      customer: { select: { id: true, name: true } },
    },
  });

  if (!workOrder) {
    return (
      <div className="office-app flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className={`${CARD} max-w-md p-6`}>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]">
            <Icon name="alert" className="h-5 w-5" />
          </span>
          <p className={`mt-3 text-sm font-bold ${MUTED}`}>
            {t("orders.reportViewer.notFoundWorkOrder")}
          </p>
          <Link href="/" className={`${INK_BUTTON} mt-4`}>
            {t("orders.reportViewer.back")}
          </Link>
        </div>
      </div>
    );
  }

  // Kundeportalbrukere kan kun se rapporter som tilhører deres egen kundekonto.
  // Sjekkes før alt annet, slik at man ikke engang kan se at oppdraget finnes.
  if (viewer?.role === "CUSTOMER") {
    if (!viewer.customerId || workOrder.customerId !== viewer.customerId) {
      redirect("/kundeportal");
    }
  }
  if (viewer.role !== "CUSTOMER" && !hasPermission(viewer, "reports.view")) {
    redirect("/");
  }
  // Ansatte ser bare rapporter i egen avdeling med mindre de er eksplisitt gitt
  // reports.viewAllDepartments. Administrator ser alle. Kansellerte oppdrag er
  // fortsatt lukket for montørene, også rapportene deres.
  if (
    viewer.role !== "CUSTOMER" &&
    !canAccessReportWorkOrder(viewer, {
      departmentId: workOrder.departmentId,
      departmentIsActive: workOrder.department?.isActive,
    })
  ) {
    redirect("/rapporter");
  }
  if (viewer.role === "TECHNICIAN" && workOrder.status === "CANCELLED") {
    redirect("/rapporter");
  }

  // Antall rapporter er en egen, avgrenset spørring. Selve visningen slår bare
  // opp den ene rapporten brukeren ba om.
  const reportCount = await prisma.report.count({
    where: { workOrderId: workOrder.id, deletedAt: null },
  });

  if (reportCount === 0) {
    return (
      <div className="office-app flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className={`${CARD} max-w-md p-6`}>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]">
            <Icon name="clipboard" className="h-5 w-5" />
          </span>
          <p className={`mt-3 text-sm font-bold ${MUTED}`}>
            {t("orders.reportViewer.noReport")}
          </p>
          <Link href="/" className={`${INK_BUTTON} mt-4`}>
            {t("orders.reportViewer.back")}
          </Link>
        </div>
      </div>
    );
  }

  const requestedReportId = String(query.rapport ?? "").trim();
  const selectedReport = requestedReportId
    ? await prisma.report.findFirst({
        where: {
          id: requestedReportId,
          workOrderId: workOrder.id,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          templateTitle: true,
          reportNumber: true,
          isLocked: true,
          lockedAt: true,
          lockedByName: true,
          customerAcknowledgedAt: true,
          customerAcknowledgedBy: true,
          requiresUnits: true,
          revision: true,
          units: { select: { label: true, status: true } },
        },
      })
    : null;

  // En eksplisitt rapport-id som ikke hører til oppdraget skal ikke falle
  // tilbake til den kombinerte PDF-en – da ville lenken vist feil dokument.
  if (requestedReportId && !selectedReport) {
    return (
      <div className="office-app flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className={`${CARD} max-w-md p-6`}>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]">
            <Icon name="alert" className="h-5 w-5" />
          </span>
          <p className={`mt-3 text-sm font-bold ${MUTED}`}>
            {t("orders.reportViewer.reportNotFound")}
          </p>
          <Link
            href={`/rapporter/${workOrder.id}`}
            className={`${INK_BUTTON} mt-4`}
          >
            {t("orders.reportViewer.back")}
          </Link>
        </div>
      </div>
    );
  }

  const returnTo = safeReturnTo(query.returnTo);
  const fallbackBackHref =
    viewer?.role === "CUSTOMER" ? "/kundeportal" : `/kunder/${workOrder.customer?.id}`;
  const backHref = returnTo ?? fallbackBackHref;
  const backLabel = returnTo?.startsWith("/sok")
    ? t("orders.reportViewer.backToSearch")
    : returnTo?.startsWith("/rapporter")
      ? t("orders.reportViewer.backToReports")
      : returnTo?.startsWith("/kunder")
        ? t("customers.reports.backToCustomer")
        : viewer?.role === "CUSTOMER"
          ? t("orders.reportViewer.backToPortal")
          : t("orders.reportViewer.closePdf");

  // PDF-en genereres på serveren og vises i en <iframe>. Da virker den i alle
  // nettlesere (også på mobil), og den kan lastes ned eller deles som en vanlig
  // lenke: /api/rapporter/<oppdragsId>/pdf[?rapport=<rapportId>]
  const pdfQuery = selectedReport
    ? `?rapport=${encodeURIComponent(selectedReport.id)}`
    : "";
  const pdfUrl = `/api/rapporter/${resolvedParams.id}/pdf${pdfQuery}`;
  const downloadUrl = `${pdfUrl}${pdfQuery ? "&" : "?"}download=1`;
  const reportName =
    selectedReport?.name ||
    selectedReport?.templateTitle ||
    t("orders.reportViewer.singleReportFallback");
  const heading = selectedReport
    ? t("orders.reportViewer.reportName", { name: reportName })
    : t("orders.reportViewer.reportFor", { title: workOrder.title });
  const iframeTitle = selectedReport ? reportName : workOrder.title;

  const acknowledgement = selectedReport
    ? reportAcknowledgement(selectedReport)
    : null;
  const summary = selectedReport ? reportUnitSummary(selectedReport) : null;
  const viewerUrl = selectedReport
    ? `/rapporter/${workOrder.id}?rapport=${encodeURIComponent(selectedReport.id)}`
    : `/rapporter/${workOrder.id}`;
  const revisionsHref = selectedReport
    ? `/rapporter/${workOrder.id}/revisjoner?rapport=${encodeURIComponent(selectedReport.id)}&returnTo=${encodeURIComponent(returnTo ?? viewerUrl)}`
    : null;
  const lockTitle = selectedReport?.isLocked
    ? selectedReport.lockedAt
      ? t("customers.reports.lockedTooltip", {
          date: formatDateLocalized(selectedReport.lockedAt, locale),
          name:
            selectedReport.lockedByName || t("customers.reports.unknownUser"),
        })
      : selectedReport.lockedByName
        ? t("customers.reports.lockedTooltipNoDate", {
            name: selectedReport.lockedByName,
          })
        : undefined
    : undefined;
  const acknowledgementTitle = acknowledgement?.by
    ? t("customers.reportList.acknowledgedBy", {
        name: acknowledgement.by,
      })
    : undefined;
  const canOpenCustomer =
    viewer.role !== "CUSTOMER" && hasPermission(viewer, "customers.view");
  const canOpenWorkOrder =
    viewer.role !== "CUSTOMER" && hasPermission(viewer, "workorders.view");
  const workOrderHref =
    viewer.role === "TECHNICIAN"
      ? `/mine-oppdrag/${workOrder.id}`
      : `/oppdrag/${workOrder.id}`;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--canvas,#f4f5f2)]">
      <header className="relative shrink-0 border-b border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)]">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 bg-[var(--signal,#d8ff3e)]"
        />
        <div className="flex flex-col gap-2.5 p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)] sm:flex">
                <Icon name="file" className="h-4 w-4" />
              </span>
              <h1 className="min-w-0 truncate text-base font-extrabold tracking-tight text-[var(--ink,#101310)] sm:text-lg">
                {heading}
              </h1>
              {selectedReport?.reportNumber && (
                <span className="shrink-0 rounded-full border border-[var(--ink,#101310)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--ink,#101310)]">
                  {t("orders.detail.report.reportNumber", {
                    number: selectedReport.reportNumber,
                  })}
                </span>
              )}
            </div>
            <p className={`mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs ${MUTED}`}>
              <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
              {canOpenWorkOrder ? (
                <Link
                  href={workOrderHref}
                  className="font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-2 transition hover:decoration-[var(--ink,#101310)]"
                >
                  {workOrder.title}
                </Link>
              ) : (
                <span className="font-bold text-[var(--ink,#101310)]">
                  {workOrder.title}
                </span>
              )}
              {workOrder.customer?.name && (
                <>
                  <span aria-hidden>·</span>
                  <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                  {canOpenCustomer && workOrder.customer ? (
                    <Link
                      href={`/kunder/${workOrder.customer.id}`}
                      className="font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-2 transition hover:decoration-[var(--ink,#101310)]"
                    >
                      {workOrder.customer.name}
                    </Link>
                  ) : (
                    <span>{workOrder.customer.name}</span>
                  )}
                </>
              )}
              {workOrder.orderNumber && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-mono tabular-nums">
                    #{workOrder.orderNumber}
                  </span>
                </>
              )}
            </p>

            {selectedReport && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                    selectedReport.isLocked
                      ? "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                      : "border-[#dfc98b] bg-[#fdf5e4] text-[#6b4808]"
                  }`}
                  title={lockTitle}
                >
                  <Icon
                    name={selectedReport.isLocked ? "shield" : "pen"}
                    className="h-3 w-3 shrink-0"
                  />
                  {selectedReport.isLocked
                    ? t("customers.reports.locked")
                    : t("customers.reports.openForEdit")}
                </span>
                {acknowledgement && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                      acknowledgement.acknowledged
                        ? "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]"
                        : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--muted,#62685f)]"
                    }`}
                    title={acknowledgementTitle}
                  >
                    <Icon
                      name={acknowledgement.acknowledged ? "check" : "clock"}
                      className="h-3 w-3 shrink-0"
                    />
                    {acknowledgement.acknowledged
                      ? t("customers.reports.acknowledged", {
                          date: formatDateLocalized(
                            acknowledgement.at,
                            locale,
                          ),
                        })
                      : t("customers.reports.notAcknowledged")}
                  </span>
                )}
                {summary && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-white px-2 py-0.5 text-[11px] font-bold text-[var(--ink,#101310)]">
                    <Icon name="wrench" className="h-3 w-3 shrink-0" />
                    {summary.usesUnits
                      ? t("orders.revisions.unitSummary", {
                          count: summary.unitCount,
                          deviations: summary.deviationCount,
                        })
                      : t("orders.revisions.noUnits")}
                  </span>
                )}
                {revisionsHref && (
                  <Link
                    href={revisionsHref}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-[11px] font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]"
                  >
                    <Icon name="clock" className="h-3 w-3 shrink-0" />
                    {selectedReport.revision > 0
                      ? t("customers.reports.revisions", {
                          count: selectedReport.revision,
                        })
                      : t("customers.reports.revisionsLabel")}
                  </Link>
                )}
              </div>
            )}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {viewer?.role !== "CUSTOMER" && (
              <a
                href={downloadUrl}
                download
                className={`${SIGNAL_BUTTON} flex-1 whitespace-nowrap sm:flex-none`}
              >
                <Icon
                  name="arrowRight"
                  className="h-4 w-4 shrink-0 rotate-90"
                />
                {t("orders.reportViewer.download")}
              </a>
            )}
            <Link
              href={backHref}
              className={`${INK_BUTTON} flex-1 whitespace-nowrap sm:flex-none`}
            >
              <Icon
                name="arrowRight"
                className="h-4 w-4 shrink-0 rotate-180"
              />
              {backLabel}
            </Link>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 p-1.5 sm:p-3">
        <iframe
          src={pdfUrl}
          title={t("orders.reportViewer.iframeTitle", { title: iframeTitle })}
          className="h-full w-full rounded-lg border border-[var(--line,#dedcd1)] bg-white shadow-[0_10px_30px_-24px_rgba(16,19,16,0.5)]"
        />
      </div>
    </div>
  );
}
