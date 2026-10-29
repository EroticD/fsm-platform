import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { canAccessReportWorkOrder } from "@/lib/report-scope";

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
  const viewer = await getCurrentUser();
  if (!viewer?.isActive) redirect("/logg-inn");

  const resolvedParams = await params;
  const query = await searchParams;

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: resolvedParams.id, deletedAt: null },
    select: {
      id: true,
      title: true,
      customerId: true,
      departmentId: true,
      department: { select: { isActive: true } },
      status: true,
      customer: { select: { id: true, name: true } },
    },
  });

  if (!workOrder) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 p-8 text-center">
        <p className="text-gray-600 font-medium">{(t("orders.reportViewer.notFoundWorkOrder"))}</p>
        <Link href="/" className="bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold">
          {t("orders.reportViewer.back")}
        </Link>
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
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 p-8 text-center">
        <p className="text-gray-600 font-medium">{(t("orders.reportViewer.noReport"))}</p>
        <Link href="/" className="bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold">
          {t("orders.reportViewer.back")}
        </Link>
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
        select: { id: true, name: true, templateTitle: true },
      })
    : null;

  // En eksplisitt rapport-id som ikke hører til oppdraget skal ikke falle
  // tilbake til den kombinerte PDF-en – da ville lenken vist feil dokument.
  if (requestedReportId && !selectedReport) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 p-8 text-center">
        <p className="text-gray-600 font-medium">
          {t("orders.reportViewer.reportNotFound")}
        </p>
        <Link
          href={`/rapporter/${workOrder.id}`}
          className="bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold"
        >
          {t("orders.reportViewer.back")}
        </Link>
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

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-gray-100">
      <div className="bg-gray-900 text-white p-4 flex flex-wrap justify-between items-center gap-3 shadow-md">
        <div>
          <h1 className="font-bold">{heading}</h1>
          <p className="text-xs text-gray-300">
            {workOrder.title}
            {workOrder.customer?.name ? ` · ${workOrder.customer.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {viewer?.role !== "CUSTOMER" && (
            <a
              href={downloadUrl}
              download
              className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm font-bold transition"
            >
              ⬇ {t("orders.reportViewer.download")}
            </a>
          )}
          <Link
            href={backHref}
            className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm font-medium transition"
          >
            {backLabel}
          </Link>
        </div>
      </div>

      <iframe
        src={pdfUrl}
        title={t("orders.reportViewer.iframeTitle", { title: iframeTitle })}
        className="flex-1 w-full border-0 bg-gray-200"
      />
    </div>
  );
}
