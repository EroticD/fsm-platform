import Link from "next/link";
import Icon from "@/components/icons";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { HMS_FORM_GROUPS } from "@/lib/hms";
import { formatDateLocalized } from "@/lib/dates";
import StatusBadge from "@/components/StatusBadge";
import PageHeader from "@/components/PageHeader";
import HmsTemplateCard from "@/components/hms/HmsTemplateCard";
import { controlClassName } from "@/components/ui/controlStyles";
import { getHmsOverview } from "@/server/hms";
import { linkHmsTemplate } from "./actions";

const CARD = "office-card";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const EYEBROW =
  "text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]";
const MUTED = "text-[var(--muted,#62685f)]";
const CHIP =
  "inline-flex items-center gap-1.5 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2.5 py-0.5 text-xs font-bold text-[var(--ink,#101310)]";
const FIELD = controlClassName("min-h-11 text-sm font-bold");

const STATUS_LABEL_KEYS: Record<string, string> = {
  OPEN: "statusOpen",
  PENDING: "statusPending",
  PLANNED: "statusPlanned",
  WAITING: "statusWaiting",
  IN_PROGRESS: "statusInProgress",
  COMPLETED: "statusCompleted",
  CANCELLED: "statusCancelled",
};

const ERROR_KEYS: Record<string, string> = {
  forbidden: "hms.error.forbidden",
  invalid: "hms.error.invalid",
  "not_found": "hms.error.notFound",
  conflict: "hms.error.locked",
  error: "hms.error.unknown",
};

export default async function HmsPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; linked?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");

  // HMS-biblioteket er internt. Kundeportalbrukere har sin egen inngang.
  if (user.role === "CUSTOMER") redirect("/kundeportal");

  const canViewLibrary = hasPermission(user, "templates.view");
  const canViewReports = hasPermission(user, "reports.view");
  if (!canViewLibrary && !canViewReports) redirect("/");

  const overview = await getHmsOverview(user);
  if (!overview.ok) redirect("/");

  const {
    templates,
    recentReports,
    workOrders,
    countsByType,
    permissions,
  } = overview.data;

  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;
  const errorKey = params.error ? ERROR_KEYS[params.error] : undefined;

  const groupByType = new Map(
    HMS_FORM_GROUPS.map((group) => [group.type, group]),
  );
  const countByType = new Map(
    countsByType.map((item) => [item.type, item.count]),
  );
  const groupsWithTemplates = HMS_FORM_GROUPS.map((group) => ({
    ...group,
    templates: templates.filter((template) => template.hmsType === group.type),
  })).filter((group) => group.templates.length > 0);

  const typeLabel = (type: string | null) => {
    if (!type) return t("hms.template.untyped");
    const group = groupByType.get(type as (typeof HMS_FORM_GROUPS)[number]["type"]);
    return group ? t(group.labelKey) : t("hms.template.untyped");
  };

  const workOrderHref = (id: string) =>
    user.role === "TECHNICIAN" ? `/mine-oppdrag/${id}` : `/oppdrag/${id}`;

  const workOrderLabel = (option: (typeof workOrders)[number]) => {
    const customer =
      option.kind === "internal"
        ? t("hms.internalWorkOrder")
        : option.customerName || t("hms.customerWorkOrder");
    const number = option.orderNumber ? `#${option.orderNumber} ` : "";
    return `${customer} – ${number}${option.title}`;
  };

  return (
    <div className="min-h-screen bg-[var(--canvas,#f4f5f2)] p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title={t("hms.title")}
          subtitle={
            <>
              <span className={EYEBROW}>{t("hms.badge")}</span>
              <span className="mt-1 block">{t("hms.subtitle")}</span>
            </>
          }
          icon={<Icon name="shield" className="h-5 w-5" />}
          actions={
            <Link href="/" className={INK_BUTTON}>
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("hms.backToDashboard")}
            </Link>
          }
        />

        {/* KATEGORIER */}
        <nav
          aria-label={t("hms.navigationLabel")}
          className={`${CARD} flex flex-wrap gap-2 p-3`}
        >
          <a
            href="#hms-skjemaer"
            className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]"
          >
            <Icon name="folder" className="h-4 w-4 shrink-0" />
            {t("hms.libraryTitle")}
          </a>
          {groupsWithTemplates.map((group) => (
            <a
              key={group.type}
              href={`#hms-type-${group.type.toLowerCase()}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]"
            >
              {t(group.labelKey)}
              <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-1.5 py-0.5 text-xs font-bold text-[var(--muted,#62685f)]">
                {countByType.get(group.type) ?? 0}
              </span>
            </a>
          ))}
          {permissions.canManageTemplates && (
            <Link
              href="/innstillinger?tab=maler&category=HMS"
              className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[#cbef35]"
            >
              <Icon name="settings" className="h-4 w-4 shrink-0" />
              {t("hms.templatesAdmin")}
            </Link>
          )}
        </nav>

        {/* TILBAKEMELDING */}
        {params.linked === "1" && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-xl border border-[var(--line,#dedcd1)] border-l-4 border-l-[var(--signal,#d8ff3e)] bg-[var(--surface,#fffdf8)] p-3 text-sm font-bold text-[var(--ink,#101310)]"
          >
            <Icon name="check" className="h-4 w-4 shrink-0" />
            {t("hms.linked")}
          </div>
        )}
        {errorKey && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[#fae8e0] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
          >
            <Icon name="alert" className="h-4 w-4 shrink-0" />
            {t(errorKey)}
          </div>
        )}

        {/* KNYTT TIL OPPDRAG */}
        {permissions.canLinkTemplates && templates.length > 0 && (
          <section
            id="knytt-til-oppdrag"
            aria-labelledby="knytt-til-oppdrag-title"
            className={`${CARD} scroll-mt-6 p-4 sm:p-5`}
          >
            <h2
              id="knytt-til-oppdrag-title"
              className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]"
            >
              <Icon name="route" className="h-4 w-4 shrink-0" />
              {t("hms.link.title")}
            </h2>
            <p className={`mt-1 text-sm ${MUTED}`}>{t("hms.link.description")}</p>

            {workOrders.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 text-sm font-medium text-[var(--muted,#62685f)]">
                {t("hms.link.noWorkOrders")}
              </p>
            ) : (
              <form
                action={linkHmsTemplate}
                className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                  {t("hms.link.templateLabel")}
                  <select
                    name="templateId"
                    required
                    defaultValue={params.template || ""}
                    className={FIELD}
                  >
                    <option value="" disabled>
                      {t("hms.link.selectTemplate")}
                    </option>
                    {groupsWithTemplates.map((group) => (
                      <optgroup key={group.type} label={t(group.labelKey)}>
                        {group.templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.title}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
                  {t("hms.link.workOrderLabel")}
                  <select
                    name="workOrderId"
                    required
                    defaultValue=""
                    className={FIELD}
                  >
                    <option value="" disabled>
                      {t("hms.link.selectWorkOrder")}
                    </option>
                    {workOrders.map((option) => (
                      <option key={option.id} value={option.id}>
                        {workOrderLabel(option)} —{" "}
                        {t(
                          STATUS_LABEL_KEYS[option.status] ?? "status",
                        )}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className={`${SIGNAL_BUTTON} w-full sm:w-auto`}
                  >
                    {t("hms.link.submit")}
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        {/* HMS-SKJEMAER */}
        {canViewLibrary && (
          <section id="hms-skjemaer" aria-labelledby="hms-skjemaer-title" className="scroll-mt-6 space-y-4">
            <div className={`${CARD} flex flex-wrap items-end justify-between gap-3 p-4 sm:p-5`}>
              <div>
                <h2 id="hms-skjemaer-title" className="flex items-center gap-2 text-lg font-extrabold text-[var(--ink,#101310)]">
                  <Icon name="folder" className="h-5 w-5 shrink-0" />
                  {t("hms.libraryTitle")}
                </h2>
                <p className={`text-sm ${MUTED}`}>
                  {t("hms.libraryDescription")}
                </p>
              </div>
              <span className={CHIP}>
                {t("hms.templateCount", { count: templates.length })}
              </span>
            </div>

            {templates.length === 0 ? (
              <div className="rounded-card border border-dashed border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-6 text-center">
                <p className="font-extrabold text-[var(--ink,#101310)]">{t("hms.empty.title")}</p>
                <p className={`mt-1 text-sm ${MUTED}`}>
                  {t("hms.empty.description")}
                </p>
                {permissions.canManageTemplates && (
                  <Link
                    href="/innstillinger?tab=maler&category=HMS"
                    className={`${SIGNAL_BUTTON} mt-4`}
                  >
                    {t("hms.empty.adminLink")}
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {groupsWithTemplates.map((group) => (
                  <section
                    key={group.type}
                    id={`hms-type-${group.type.toLowerCase()}`}
                    aria-labelledby={`hms-type-${group.type.toLowerCase()}-title`}
                    className="scroll-mt-6 space-y-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
                      <div>
                        <h3
                          id={`hms-type-${group.type.toLowerCase()}-title`}
                          className="text-base font-extrabold text-[var(--ink,#101310)]"
                        >
                          {t(group.labelKey)}
                        </h3>
                        <p className={`text-sm ${MUTED}`}>
                          {t(group.descriptionKey)}
                        </p>
                      </div>
                      <span className={CHIP}>
                        {countByType.get(group.type) ?? 0}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {group.templates.map((template) => (
                        <HmsTemplateCard
                          key={template.id}
                          template={template}
                          typeLabel={typeLabel(template.hmsType)}
                          canManage={permissions.canManageTemplates}
                          canLink={permissions.canLinkTemplates}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        )}

        {/* SISTE HMS-DOKUMENTASJON */}
        {canViewReports && (
          <section
            aria-labelledby="hms-dokumentasjon-title"
            className={`${CARD} p-4 sm:p-5`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
              <div>
                <h2 id="hms-dokumentasjon-title" className="flex items-center gap-2 text-lg font-extrabold text-[var(--ink,#101310)]">
                  <Icon name="file" className="h-5 w-5 shrink-0" />
                  {t("hms.recent.title")}
                </h2>
                <p className={`text-sm ${MUTED}`}>
                  {t("hms.recent.description")}
                </p>
              </div>
              <span className={CHIP}>
                {t("hms.recent.count", { count: recentReports.length })}
              </span>
            </div>

            {recentReports.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-6 text-center">
                <p className="font-extrabold text-[var(--ink,#101310)]">
                  {t("hms.recent.emptyTitle")}
                </p>
                <p className={`mt-1 text-sm ${MUTED}`}>
                  {t("hms.recent.emptyDescription")}
                </p>
              </div>
            ) : (
              <>
              <div className="mt-4 hidden overflow-x-auto sm:block" role="region" aria-label={t("hms.recent.title")} tabIndex={0}>
                <table className="office-table">
                  <caption className="sr-only">{t("hms.recent.title")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("hms.recent.workOrder")}</th>
                      <th scope="col">{t("hms.recent.report")}</th>
                      <th scope="col">{t("hms.recent.completed")}</th>
                      <th scope="col">{t("hms.recent.status")}</th>
                      <th scope="col">{t("hms.recent.actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentReports.map((report) => (
                      <tr key={report.id} className="align-top">
                        <td>
                          <Link
                            href={workOrderHref(report.workOrder.id)}
                            className="font-bold text-[var(--ink,#101310)] underline-offset-2 hover:underline"
                          >
                            {report.workOrder.title}
                          </Link>
                          <p className="mt-0.5 text-xs text-[var(--muted,#62685f)]">
                            {report.workOrder.customerId ? (
                              <span className="inline-flex items-center gap-1">
                                <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                                {report.workOrder.customerName || t("hms.customerWorkOrder")}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1">
                                <Icon name="home" className="h-3.5 w-3.5 shrink-0" />
                                {t("hms.internalWorkOrder")}
                              </span>
                            )}
                            {report.workOrder.orderNumber
                              ? ` • #${report.workOrder.orderNumber}`
                              : ""}
                          </p>
                        </td>
                        <td>
                          <p className="font-semibold text-[var(--ink,#101310)]">
                            {report.reportName || t("hms.recent.unknownReport")}
                          </p>
                          <p className="text-xs text-[var(--muted,#62685f)]">
                            {typeLabel(report.hmsType)}
                          </p>
                        </td>
                        <td className="whitespace-nowrap text-xs text-[var(--muted,#62685f)]">
                          {formatDateLocalized(
                            report.completedAt,
                            locale,
                            undefined,
                            t("hms.recent.noDate"),
                          )}
                        </td>
                        <td>
                          <StatusBadge status={report.workOrder.status} />
                        </td>
                        <td>
                          <div className="flex flex-col gap-1 text-xs font-bold">
                            <Link
                              href={`/rapporter/${report.workOrder.id}?rapport=${report.id}`}
                              className="inline-flex min-h-6 items-center gap-1.5 text-[var(--ink,#101310)] underline-offset-2 hover:underline"
                            >
                              <Icon name="file" className="h-3.5 w-3.5 shrink-0" />
                              {t("hms.recent.viewPdf")}
                            </Link>
                            <Link
                              href={workOrderHref(report.workOrder.id)}
                              className="inline-flex min-h-6 items-center gap-1.5 text-[var(--muted,#62685f)] underline-offset-2 hover:text-[var(--ink,#101310)] hover:underline"
                            >
                              <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                              {t("hms.recent.openWorkOrder")}
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* På mobil blir den brede tabellen korte, stablede rader. */}
              <ul className="mt-4 divide-y divide-[var(--line,#dedcd1)] sm:hidden">
                {recentReports.map((report) => (
                  <li key={report.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link
                        href={workOrderHref(report.workOrder.id)}
                        className="min-w-0 break-words font-bold text-[var(--ink,#101310)] underline-offset-2 hover:underline"
                      >
                        {report.workOrder.title}
                      </Link>
                      <StatusBadge status={report.workOrder.status} />
                    </div>
                    <p className="break-words text-xs text-[var(--muted,#62685f)]">
                      {report.workOrder.customerId ? (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                          {report.workOrder.customerName || t("hms.customerWorkOrder")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="home" className="h-3.5 w-3.5 shrink-0" />
                          {t("hms.internalWorkOrder")}
                        </span>
                      )}
                      {report.workOrder.orderNumber
                        ? ` • #${report.workOrder.orderNumber}`
                        : ""}
                    </p>
                    <dl className="space-y-1 text-xs">
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-bold text-[var(--muted,#62685f)]">
                          {t("hms.recent.report")}:
                        </dt>
                        <dd className="min-w-0 break-words text-[var(--ink,#101310)]">
                          {report.reportName || t("hms.recent.unknownReport")}
                          {" • "}
                          {typeLabel(report.hmsType)}
                        </dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-bold text-[var(--muted,#62685f)]">
                          {t("hms.recent.completed")}:
                        </dt>
                        <dd className="text-[var(--muted,#62685f)]">
                          {formatDateLocalized(
                            report.completedAt,
                            locale,
                            undefined,
                            t("hms.recent.noDate"),
                          )}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-3 text-xs font-bold">
                      <Link
                        href={`/rapporter/${report.workOrder.id}?rapport=${report.id}`}
                        className="inline-flex min-h-11 items-center gap-1.5 text-[var(--ink,#101310)] underline-offset-2 hover:underline"
                      >
                        <Icon name="file" className="h-3.5 w-3.5 shrink-0" />
                        {t("hms.recent.viewPdf")}
                      </Link>
                      <Link
                        href={workOrderHref(report.workOrder.id)}
                        className="inline-flex min-h-11 items-center gap-1.5 text-[var(--muted,#62685f)] underline-offset-2 hover:text-[var(--ink,#101310)] hover:underline"
                      >
                        <Icon name="folder" className="h-3.5 w-3.5 shrink-0" />
                        {t("hms.recent.openWorkOrder")}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
