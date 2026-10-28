import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { HmsTemplateSummary } from "@/server/hms";

/**
 * Ett HMS-skjema i biblioteket. Kortet er en serverkomponent fordi det bare
 * viser data og vanlige lenker – ingen klienttilstand trengs.
 */
export default async function HmsTemplateCard({
  template,
  typeLabel,
  canManage,
  canLink,
}: {
  template: HmsTemplateSummary;
  typeLabel: string;
  canManage: boolean;
  canLink: boolean;
}) {
  const t = await getTranslations("common");

  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-black text-gray-900 break-words">{template.title}</h3>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-800">
          {typeLabel}
        </span>
      </div>

      <p className="text-sm text-gray-600">
        {template.description || t("hms.template.noDescription")}
      </p>

      <dl className="mt-auto space-y-1 text-[11px] text-gray-600">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-bold text-gray-700">
            {t("hms.template.reportName")}:
          </dt>
          <dd className="truncate">{template.reportName || template.title}</dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 font-bold">
            {t("hms.template.reports", { count: template.reportCount })}
          </span>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 font-bold">
            {t("hms.template.workOrders", { count: template.workOrderCount })}
          </span>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
        {canLink && (
          <Link
            href={`/hms?template=${encodeURIComponent(template.id)}#knytt-til-oppdrag`}
            className="inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {t("hms.template.use")}
          </Link>
        )}
        {canManage && (
          <Link
            href={`/innstillinger/maler/${template.id}`}
            className="inline-flex min-h-11 items-center rounded-xl border-2 border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {t("hms.template.edit")}
          </Link>
        )}
      </div>
    </article>
  );
}
