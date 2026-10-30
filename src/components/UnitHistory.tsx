import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import MarkdownView from "@/components/MarkdownView";
import Icon from "@/components/icons";
import { formatDateLocalized } from "@/lib/dates";
import {
  isLineCommentKey,
  needsComment,
  parseImageUrls,
  parseJsonObject,
  readLineComment,
} from "@/lib/report-answers";

/** Feltene slik de er lagret i malens `fieldsJson`. */
type HistoryField = {
  id: string;
  type?: string;
  label?: string;
  options?: string[];
  commentOptions?: string[];
};

/** Én kontroll av enheten – slik den så ut da rapporten ble fylt ut. */
export type UnitHistoryEntry = {
  id: string;
  status: string;
  comment: string | null;
  answersJson: string;
  report: {
    id: string;
    createdAt: Date | string | null;
    template: { title: string; fieldsJson: string } | null;
    workOrderId: string;
    workOrder: { id: string; title: string; scheduledFor: Date | string | null };
  };
};

/** Datoen servicen ble utført – oppdragets dato er den montøren forholder seg til. */
function serviceDate(entry: UnitHistoryEntry) {
  return entry.report.workOrder.scheduledFor ?? entry.report.createdAt;
}

function fieldValue(
  field: HistoryField | null,
  value: unknown,
  translate: (key: string, values?: Record<string, string | number>) => string,
) {
  if (field?.type === "CHECKBOX") return value ? translate("orders.unitHistory.yesDone") : translate("orders.unitHistory.noDone");
  if (field?.type === "IMAGE") {
    const urls = parseImageUrls(value);
    if (urls.length === 0) return translate("orders.unitHistory.noImages");
    return translate("orders.unitHistory.imageCount", { count: urls.length });
  }
  if (value === undefined || value === null || value === "") return translate("orders.unitHistory.notAnswered");
  return String(value);
}

/**
 * Servicehistorikk for én enhet: alle tidligere rapporter der enheten ble
 * kontrollert, med sjekkpunktene slik de ble besvart den gangen.
 *
 * Radene er lagret som «øyeblikksbilder» på rapporten, så historikken endres
 * ikke selv om malen eller enheten redigeres senere.
 */
export default async function UnitHistory({ entries }: { entries: UnitHistoryEntry[] }) {
  const t = await getTranslations("common");
  const locale = await getLocale();
  const translate = (key: string, values?: Record<string, string | number>) =>
    t(key, values);
  const history = [...entries].sort(
    (a, b) => new Date(serviceDate(b) ?? 0).getTime() - new Date(serviceDate(a) ?? 0).getTime(),
  );

  if (history.length === 0) {
    return (
      <p className="text-xs italic text-[var(--muted,#62685f)]">
        {t("orders.unitHistory.empty")}
      </p>
    );
  }

  return (
    <ol className="space-y-2 [--focus-ring:var(--ink,#101310)]">
      {history.map((entry) => {
        let fields: HistoryField[] = [];
        try {
          const parsed = JSON.parse(entry.report.template?.fieldsJson ?? "[]");
          if (Array.isArray(parsed)) fields = parsed as HistoryField[];
        } catch {
          fields = [];
        }

        const answers = parseJsonObject(entry.answersJson);
        const rows =
          fields.length > 0
            ? fields.map((field) => ({ field, label: field.label ?? "", value: answers[field.id] }))
            : Object.entries(answers)
                .filter(([key]) => !isLineCommentKey(key))
                .map(([label, value]) => ({ field: null as HistoryField | null, label, value }));

        const images = [
          ...new Set(
            rows.flatMap((row) =>
              row.field?.type === "IMAGE"
                ? parseImageUrls((row.value as string) ?? "").map((url) => url)
                : [],
            ),
          ),
        ];

        const ok = entry.status !== "AVVIK";

        return (
          <li key={entry.id} className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-[var(--ink,#101310)]">
                {formatDateLocalized(
                  serviceDate(entry),
                  locale,
                  undefined,
                  t("orders.unitHistory.noDate"),
                )}
                <span className="font-normal text-[var(--muted,#62685f)]">
                  {" • "}
                  {entry.report.template?.title ?? t("orders.unitHistory.serviceReport")}
                </span>
              </p>
              <span
                className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${
                  ok
                    ? "border-[#b9cdb4] bg-[#eaf3e4] text-[#24502f]"
                    : "border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)]"
                }`}
              >
                <Icon
                  name={ok ? "check" : "alert"}
                  className="h-3.5 w-3.5 shrink-0"
                  strokeWidth={2}
                />
                {ok ? t("orders.unitHistory.approved") : t("orders.unitHistory.deviation")}
              </span>
            </div>

            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">{entry.report.workOrder.title}</p>

            {entry.comment ? (
              <div className="mt-1 text-xs text-[var(--ink,#101310)]">
                <MarkdownView value={entry.comment} size="sm" />
              </div>
            ) : null}

            {rows.length > 0 ? (
              <details className="mt-2">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4">
                  {t("orders.unitHistory.showCheckpoints", { count: rows.length })}
                </summary>
                <div className="mt-1.5 space-y-1.5 border-l-2 border-[var(--line,#dedcd1)] pl-2">
                  {rows.map((row, index) => {
                    const comment = row.field ? readLineComment(answers, row.field.id) : "";
                    const alert = row.field ? needsComment(row.field, row.value) : false;
                    // Fritekstsvar kan være skrevet i Markdown og vises som eget avsnitt.
                    const richText =
                      row.field?.type === "TEXTAREA" || row.field?.type === "TEXT";
                    const richValue = typeof row.value === "string" ? row.value.trim() : "";
                    return (
                      <div key={`${row.label}-${index}`} className="text-xs">
                        <p className={alert ? "font-bold text-[var(--risk-text,#b42318)]" : "text-[#3d4237]"}>
                          <span className="font-bold text-[var(--ink,#101310)]">{row.label}: </span>
                          {richText ? null : fieldValue(row.field, row.value, translate)}
                        </p>
                        {richText ? (
                          richValue ? (
                            <div className="mt-0.5 text-[var(--ink,#101310)]">
                              <MarkdownView value={richValue} size="xs" />
                            </div>
                          ) : (
                            <p className="text-[var(--muted,#62685f)]">{t("orders.unitHistory.notAnswered")}</p>
                          )
                        ) : null}
                        {comment ? (
                          <div className="text-xs italic text-warning">
                            <MarkdownView value={comment} size="xs" />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </details>
            ) : null}

            {images.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {images.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={t("orders.unitHistory.imageAlt")}
                      loading="lazy"
                      className="h-14 w-14 rounded-lg border border-[var(--line,#dedcd1)] object-cover"
                    />
                  </a>
                ))}
              </div>
            ) : null}

            <div className="mt-2 flex flex-wrap gap-3">
              <Link
                href={`/rapporter/${entry.report.workOrderId}?rapport=${entry.report.id}`}
                className="inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 hover:decoration-[var(--ink,#101310)]"
              >
                <Icon name="file" className="h-3.5 w-3.5 shrink-0" />
                {t("orders.unitHistory.openReport")}
              </Link>
              <Link
                href={`/oppdrag/${entry.report.workOrder.id}`}
                className="inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-[var(--muted,#62685f)] underline decoration-transparent decoration-2 underline-offset-4 transition hover:text-[var(--ink,#101310)] hover:decoration-[var(--signal,#d8ff3e)]"
              >
                <Icon name="clipboard" className="h-3.5 w-3.5 shrink-0" />
                {t("orders.unitHistory.openWorkOrder")}
              </Link>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
