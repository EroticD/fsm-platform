import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { HMS_FORM_GROUPS } from "@/lib/hms";
import { formatDateLocalized } from "@/lib/dates";
import StatusBadge from "@/components/StatusBadge";
import HmsTemplateCard from "@/components/hms/HmsTemplateCard";
import { getHmsOverview } from "@/server/hms";
import { linkHmsTemplate } from "./actions";

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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* HEADER */}
        <div className="flex flex-col gap-4 border-b border-gray-300 pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-blue-700">
              {t("hms.badge")}
            </p>
            <h1 className="text-2xl font-black text-gray-900 md:text-3xl">
              🦺 {t("hms.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm font-medium text-gray-600">
              {t("hms.subtitle")}
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm transition hover:bg-gray-100"
          >
            ← {t("hms.backToDashboard")}
          </Link>
        </div>

        {/* KATEGORIER */}
        <nav
          aria-label={t("hms.navigationLabel")}
          className="flex flex-wrap gap-2 rounded-2xl border-2 border-gray-200 bg-white p-3 shadow-sm"
        >
          <a
            href="#hms-skjemaer"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-800 transition hover:border-blue-300 hover:bg-blue-50"
          >
            📚 {t("hms.libraryTitle")}
          </a>
          {groupsWithTemplates.map((group) => (
            <a
              key={group.type}
              href={`#hms-type-${group.type.toLowerCase()}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-800 transition hover:border-blue-300 hover:bg-blue-50"
            >
              {t(group.labelKey)}
              <span className="rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-600">
                {countByType.get(group.type) ?? 0}
              </span>
            </a>
          ))}
          {permissions.canManageTemplates && (
            <Link
              href="/innstillinger?tab=maler&category=HMS"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800 transition hover:bg-blue-100"
            >
              ⚙️ {t("hms.templatesAdmin")}
            </Link>
          )}
        </nav>

        {/* TILBAKEMELDING */}
        {params.linked === "1" && (
          <div
            role="status"
            className="rounded-2xl border-2 border-green-200 bg-green-50 p-3 text-sm font-bold text-green-900"
          >
            ✅ {t("hms.linked")}
          </div>
        )}
        {errorKey && (
          <div
            role="alert"
            className="rounded-2xl border-2 border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900"
          >
            ⚠️ {t(errorKey)}
          </div>
        )}

        {/* KNYTT TIL OPPDRAG */}
        {permissions.canLinkTemplates && templates.length > 0 && (
          <section
            id="knytt-til-oppdrag"
            aria-labelledby="knytt-til-oppdrag-title"
            className="scroll-mt-6 rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <h2
              id="knytt-til-oppdrag-title"
              className="text-base font-black text-gray-900"
            >
              🔗 {t("hms.link.title")}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {t("hms.link.description")}
            </p>

            {workOrders.length === 0 ? (
              <p className="mt-3 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-3 text-sm font-medium text-gray-600">
                {t("hms.link.noWorkOrders")}
              </p>
            ) : (
              <form
                action={linkHmsTemplate}
                className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
              >
                <label className="flex flex-col gap-1 text-sm font-bold text-gray-800">
                  {t("hms.link.templateLabel")}
                  <select
                    name="templateId"
                    required
                    defaultValue={params.template || ""}
                    className="min-h-11 w-full rounded-xl border-2 border-gray-300 bg-white p-3 text-sm font-bold text-gray-900 focus:border-blue-600"
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

                <label className="flex flex-col gap-1 text-sm font-bold text-gray-800">
                  {t("hms.link.workOrderLabel")}
                  <select
                    name="workOrderId"
                    required
                    defaultValue=""
                    className="min-h-11 w-full rounded-xl border-2 border-gray-300 bg-white p-3 text-sm font-bold text-gray-900 focus:border-blue-600"
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
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-blue-700 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-800 sm:w-auto"
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
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="hms-skjemaer-title" className="text-xl font-black text-gray-900">
                  📚 {t("hms.libraryTitle")}
                </h2>
                <p className="text-sm text-gray-600">
                  {t("hms.libraryDescription")}
                </p>
              </div>
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-700">
                {t("hms.templateCount", { count: templates.length })}
              </span>
            </div>

            {templates.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white p-6 text-center">
                <p className="font-black text-gray-900">{t("hms.empty.title")}</p>
                <p className="mt-1 text-sm text-gray-600">
                  {t("hms.empty.description")}
                </p>
                {permissions.canManageTemplates && (
                  <Link
                    href="/innstillinger?tab=maler&category=HMS"
                    className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800"
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
                    <div>
                      <h3
                        id={`hms-type-${group.type.toLowerCase()}-title`}
                        className="text-lg font-black text-gray-900"
                      >
                        {t(group.labelKey)}
                      </h3>
                      <p className="text-sm text-gray-600">
                        {t(group.descriptionKey)}
                      </p>
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
            className="rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 pb-3">
              <div>
                <h2 id="hms-dokumentasjon-title" className="text-xl font-black text-gray-900">
                  📄 {t("hms.recent.title")}
                </h2>
                <p className="text-sm text-gray-600">
                  {t("hms.recent.description")}
                </p>
              </div>
              <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-bold text-gray-700">
                {t("hms.recent.count", { count: recentReports.length })}
              </span>
            </div>

            {recentReports.length === 0 ? (
              <div className="mt-4 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-6 text-center">
                <p className="font-black text-gray-900">
                  {t("hms.recent.emptyTitle")}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  {t("hms.recent.emptyDescription")}
                </p>
              </div>
            ) : (
              <>
              <div className="mt-4 hidden overflow-x-auto sm:block" role="region" aria-label={t("hms.recent.title")} tabIndex={0}>
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">{t("hms.recent.title")}</caption>
                  <thead>
                    <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                      <th scope="col" className="px-2 py-2 font-bold">
                        {t("hms.recent.workOrder")}
                      </th>
                      <th scope="col" className="px-2 py-2 font-bold">
                        {t("hms.recent.report")}
                      </th>
                      <th scope="col" className="px-2 py-2 font-bold">
                        {t("hms.recent.completed")}
                      </th>
                      <th scope="col" className="px-2 py-2 font-bold">
                        {t("hms.recent.status")}
                      </th>
                      <th scope="col" className="px-2 py-2 font-bold">
                        {t("hms.recent.actions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recentReports.map((report) => (
                      <tr key={report.id} className="align-top">
                        <td className="px-2 py-3">
                          <Link
                            href={workOrderHref(report.workOrder.id)}
                            className="font-bold text-blue-800 hover:underline"
                          >
                            {report.workOrder.title}
                          </Link>
                          <p className="mt-0.5 text-xs text-gray-600">
                            {report.workOrder.customerId
                              ? `🏢 ${report.workOrder.customerName || t("hms.customerWorkOrder")}`
                              : `🏠 ${t("hms.internalWorkOrder")}`}
                            {report.workOrder.orderNumber
                              ? ` • #${report.workOrder.orderNumber}`
                              : ""}
                          </p>
                        </td>
                        <td className="px-2 py-3">
                          <p className="font-medium text-gray-900">
                            {report.reportName || t("hms.recent.unknownReport")}
                          </p>
                          <p className="text-xs text-gray-600">
                            {typeLabel(report.hmsType)}
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-gray-700">
                          {formatDateLocalized(
                            report.completedAt,
                            locale,
                            undefined,
                            t("hms.recent.noDate"),
                          )}
                        </td>
                        <td className="px-2 py-3">
                          <StatusBadge status={report.workOrder.status} />
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex flex-col gap-1 text-xs font-bold">
                            <Link
                              href={`/rapporter/${report.workOrder.id}?rapport=${report.id}`}
                              className="inline-flex min-h-6 items-center text-blue-800 hover:underline"
                            >
                              📄 {t("hms.recent.viewPdf")}
                            </Link>
                            <Link
                              href={workOrderHref(report.workOrder.id)}
                              className="inline-flex min-h-6 items-center text-gray-700 hover:underline"
                            >
                              📂 {t("hms.recent.openWorkOrder")}
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* På mobil blir den brede tabellen korte, stablede rader. */}
              <ul className="mt-4 divide-y divide-gray-100 sm:hidden">
                {recentReports.map((report) => (
                  <li key={report.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link
                        href={workOrderHref(report.workOrder.id)}
                        className="min-w-0 break-words font-bold text-blue-800 hover:underline"
                      >
                        {report.workOrder.title}
                      </Link>
                      <StatusBadge status={report.workOrder.status} />
                    </div>
                    <p className="break-words text-xs text-gray-600">
                      {report.workOrder.customerId
                        ? `🏢 ${report.workOrder.customerName || t("hms.customerWorkOrder")}`
                        : `🏠 ${t("hms.internalWorkOrder")}`}
                      {report.workOrder.orderNumber
                        ? ` • #${report.workOrder.orderNumber}`
                        : ""}
                    </p>
                    <dl className="space-y-1 text-xs">
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-bold text-gray-700">
                          {t("hms.recent.report")}:
                        </dt>
                        <dd className="min-w-0 break-words text-gray-900">
                          {report.reportName || t("hms.recent.unknownReport")}
                          {" • "}
                          {typeLabel(report.hmsType)}
                        </dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-bold text-gray-700">
                          {t("hms.recent.completed")}:
                        </dt>
                        <dd className="text-gray-700">
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
                        className="inline-flex min-h-11 items-center text-blue-800 hover:underline"
                      >
                        📄 {t("hms.recent.viewPdf")}
                      </Link>
                      <Link
                        href={workOrderHref(report.workOrder.id)}
                        className="inline-flex min-h-11 items-center text-gray-700 hover:underline"
                      >
                        📂 {t("hms.recent.openWorkOrder")}
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
