import { requireModulePage } from "@/lib/module-guards";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { getReportRevisionForPdf } from "@/server/report-revisions";
import { pdfViewerUrls } from "@/lib/pdf-viewer";
import PdfViewer from "@/components/PdfViewer";
import Icon from "@/components/icons";

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

export default async function ReportRevisionPdfViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; revisjonId: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  await requireModulePage("reports");
  const t = await getTranslations("common");
  const viewer = await getCurrentUser();
  if (!viewer?.isActive) redirect("/logg-inn");

  const { id, revisjonId } = await params;
  const query = await searchParams;
  const returnTo = safeReturnTo(query.returnTo);
  const result = await getReportRevisionForPdf(viewer, revisjonId);

  // Revisjonen må tilhøre oppdraget i adressen. Uten denne kontrollen kunne en
  // gyldig revisjons-id vises under feil oppdrag i nettleserfanen.
  if (!result.ok || result.data.workOrder.id !== id) {
    const message = result.ok
      ? t("orders.pdfViewer.errors.notFound")
      : result.error === "forbidden"
        ? t("orders.pdfViewer.errors.forbidden")
        : t("orders.pdfViewer.errors.notFound");
    return (
      <div className="office-app flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className={`${CARD} max-w-md p-6`}>
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-[#e7b5ae] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]">
            <Icon name="alert" className="h-5 w-5" />
          </span>
          <p className={`mt-3 text-sm font-bold ${MUTED}`}>{message}</p>
          <Link href={`/rapporter/${id}/revisjoner`} className={`${INK_BUTTON} mt-4`}>
            {t("orders.revisions.back")}
          </Link>
        </div>
      </div>
    );
  }

  const revision = result.data;
  const reportName =
    revision.name ||
    revision.templateTitle ||
    revision.workOrder.title ||
    t("orders.revisions.defaultName");
  const heading = t("orders.revisions.viewerTitle", {
    revision: revision.revision,
    name: reportName,
  });
  const revisionsHref = `/rapporter/${id}/revisjoner?rapport=${encodeURIComponent(
    revision.report.id,
  )}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  const backHref = returnTo ?? revisionsHref;
  const backLabel = returnTo
    ? t("orders.revisions.back")
    : t("orders.revisions.backToRevisions");
  const { inline: pdfUrl, download: downloadUrl } = pdfViewerUrls(
    `/api/rapporter/revisjoner/${revision.id}/pdf`,
  );

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
                <Icon name="clock" className="h-4 w-4" />
              </span>
              <h1 className="min-w-0 truncate text-base font-extrabold tracking-tight text-[var(--ink,#101310)] sm:text-lg">
                {heading}
              </h1>
            </div>
            <p className={`mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs ${MUTED}`}>
              <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
              <span className="font-bold text-[var(--ink,#101310)]">
                {revision.workOrder.title}
              </span>
              {revision.report.reportNumber && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-mono">
                    {t("orders.revisions.reportNumber")}:{" "}
                    {revision.report.reportNumber}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${INK_BUTTON} flex-1 whitespace-nowrap sm:flex-none`}
            >
              <Icon name="file" className="h-4 w-4 shrink-0" />
              {t("orders.pdfViewer.openInNewTab")}
            </a>
            <a
              href={downloadUrl}
              download
              className={`${SIGNAL_BUTTON} flex-1 whitespace-nowrap sm:flex-none`}
            >
              <Icon name="arrowRight" className="h-4 w-4 shrink-0 rotate-90" />
              {t("orders.revisions.downloadPdf")}
            </a>
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

      <div className="flex min-h-0 flex-1 flex-col p-1.5 sm:p-3">
        <PdfViewer
          src={pdfUrl}
          title={reportName}
          downloadHref={downloadUrl}
          openHref={pdfUrl}
        />
      </div>
    </div>
  );
}
