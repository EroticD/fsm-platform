import Link from "next/link";
import MarkdownView from "@/components/MarkdownView";
import { formatDate } from "@/lib/dates";
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

function fieldValue(field: HistoryField | null, value: unknown) {
  if (field?.type === "CHECKBOX") return value ? "Ja / utført" : "Nei / ikke utført";
  if (field?.type === "IMAGE") {
    const urls = parseImageUrls(value);
    if (urls.length === 0) return "Ingen bilder";
    return `${urls.length} bilde${urls.length === 1 ? "" : "r"}`;
  }
  if (value === undefined || value === null || value === "") return "Ikke besvart";
  return String(value);
}

/**
 * Servicehistorikk for én enhet: alle tidligere rapporter der enheten ble
 * kontrollert, med sjekkpunktene slik de ble besvart den gangen.
 *
 * Radene er lagret som «øyeblikksbilder» på rapporten, så historikken endres
 * ikke selv om malen eller enheten redigeres senere.
 */
export default function UnitHistory({ entries }: { entries: UnitHistoryEntry[] }) {
  const history = [...entries].sort(
    (a, b) => new Date(serviceDate(b) ?? 0).getTime() - new Date(serviceDate(a) ?? 0).getTime(),
  );

  if (history.length === 0) {
    return (
      <p className="text-xs text-gray-500 italic">
        Ingen tidligere servicer registrert på denne enheten.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
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
          <li key={entry.id} className="bg-white border border-gray-200 rounded-lg p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-gray-900">
                {formatDate(serviceDate(entry), "Ingen dato")}
                <span className="font-normal text-gray-500">
                  {" • "}
                  {entry.report.template?.title ?? "Servicerapport"}
                </span>
              </p>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  ok
                    ? "bg-green-100 text-green-800 border-green-200"
                    : "bg-red-100 text-red-800 border-red-200"
                }`}
              >
                {ok ? "✅ Godkjent" : "❌ Avvik"}
              </span>
            </div>

            <p className="text-[11px] text-gray-600 mt-1">{entry.report.workOrder.title}</p>

            {entry.comment ? (
              <div className="text-xs text-gray-700 mt-1">
                <MarkdownView value={entry.comment} size="sm" />
              </div>
            ) : null}

            {rows.length > 0 ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] font-bold text-blue-700">
                  Vis sjekkpunkter ({rows.length})
                </summary>
                <div className="mt-1.5 space-y-1.5 border-l-2 border-gray-200 pl-2">
                  {rows.map((row, index) => {
                    const comment = row.field ? readLineComment(answers, row.field.id) : "";
                    const alert = row.field ? needsComment(row.field, row.value) : false;
                    // Fritekstsvar kan være skrevet i Markdown og vises som eget avsnitt.
                    const richText =
                      row.field?.type === "TEXTAREA" || row.field?.type === "TEXT";
                    const richValue = typeof row.value === "string" ? row.value.trim() : "";
                    return (
                      <div key={`${row.label}-${index}`} className="text-[11px]">
                        <p className={alert ? "text-red-800 font-bold" : "text-gray-700"}>
                          <span className="font-bold text-gray-900">{row.label}: </span>
                          {richText ? null : fieldValue(row.field, row.value)}
                        </p>
                        {richText ? (
                          richValue ? (
                            <div className="text-gray-800 mt-0.5">
                              <MarkdownView value={richValue} size="xs" />
                            </div>
                          ) : (
                            <p className="text-gray-400">Ikke besvart</p>
                          )
                        ) : null}
                        {comment ? (
                          <div className="text-[11px] text-amber-800 italic">
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
              <div className="flex flex-wrap gap-1.5 mt-2">
                {images.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Bilde fra servicerapporten"
                      loading="lazy"
                      className="h-14 w-14 object-cover rounded-lg border border-gray-200"
                    />
                  </a>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-3 mt-2">
              <Link
                href={`/rapporter/${entry.report.workOrderId}`}
                className="text-[11px] font-bold text-blue-700 hover:underline"
              >
                📄 Se rapport (PDF)
              </Link>
              <Link
                href={`/oppdrag/${entry.report.workOrder.id}`}
                className="text-[11px] font-bold text-gray-600 hover:underline"
              >
                📋 Åpne oppdraget
              </Link>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
