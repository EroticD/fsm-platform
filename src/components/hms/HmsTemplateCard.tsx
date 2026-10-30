import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { HmsTemplateSummary } from "@/server/hms";

const CARD =
  "office-card flex h-full flex-col gap-3 p-4 transition hover:border-[#bdb3a0]";
const SIGNAL_LINK =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] transition hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const INK_LINK =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-xs font-bold text-[var(--ink,#101310)]";

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
    <article className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-extrabold text-[var(--ink,#101310)]">
          {template.title}
        </h3>
        <span className={CHIP}>{typeLabel}</span>
      </div>

      <p className="text-sm text-[var(--muted,#62685f)]">
        {template.description || t("hms.template.noDescription")}
      </p>

      <dl className="mt-auto space-y-1 border-t border-[var(--line,#dedcd1)] pt-2 text-xs text-[var(--muted,#62685f)]">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-bold text-[var(--ink,#101310)]">
            {t("hms.template.reportName")}:
          </dt>
          <dd className="truncate">{template.reportName || template.title}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-1.5">
        <span className={CHIP}>
          {t("hms.template.reports", { count: template.reportCount })}
        </span>
        <span className={CHIP}>
          {t("hms.template.workOrders", { count: template.workOrderCount })}
        </span>
      </div>

      <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--line,#dedcd1)] pt-3">
        {canLink && (
          <Link
            href={`/hms?template=${encodeURIComponent(template.id)}#knytt-til-oppdrag`}
            className={SIGNAL_LINK}
          >
            {t("hms.template.use")}
          </Link>
        )}
        {canManage && (
          <Link
            href={`/innstillinger/maler/${template.id}`}
            className={INK_LINK}
          >
            {t("hms.template.edit")}
          </Link>
        )}
      </div>
    </article>
  );
}
