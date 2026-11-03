import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import type { EvidenceCandidate } from "@/server/evidence-export";

type EvidenceExportTabProps = {
  candidates: EvidenceCandidate[];
};

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";

/**
 * Administratorens bevis-eksport. Skjemaet er en vanlig GET til API-ruten, slik
 * at nettleseren laster ned ZIP-en uten å holde den i React-treet. Ruten
 * reautoriserer administrator, så skjulte knapper er ikke tilgangskontroll.
 */
export default async function EvidenceExportTab({
  candidates,
}: EvidenceExportTabProps) {
  const t = await getTranslations("common");

  return (
    <section className="office-card space-y-4 p-5 sm:p-6">
      <div className="flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
        <Icon name="folder" className="h-4 w-4 shrink-0 text-[var(--ink,#101310)]" />
        <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
          {t("settings.evidence.title")}
        </h2>
      </div>
      <p className="text-sm text-[var(--muted,#62685f)]">
        {t("settings.evidence.desc")}
      </p>

      {candidates.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-5 text-sm text-[var(--muted,#62685f)]">
          {t("settings.evidence.empty")}
        </p>
      ) : (
        <form
          method="GET"
          action="/api/innstillinger/bevis/export"
          className="flex flex-col gap-3 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 sm:flex-row sm:items-end sm:p-4"
        >
          <label className="flex flex-1 flex-col gap-1 text-xs font-bold text-[var(--ink,#101310)]">
            {t("settings.evidence.selectWorkOrder")}
            <select name="oppdrag" required className={FIELD} defaultValue="">
              <option value="" disabled>
                {t("settings.evidence.selectPlaceholder")}
              </option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.reference} – {candidate.title}
                  {candidate.customerName ? ` (${candidate.customerName})` : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={SIGNAL_BUTTON}>
            {t("settings.evidence.exportButton")}
          </button>
        </form>
      )}

      <div className="rounded-xl border border-[var(--line,#dedcd1)] p-3 text-xs text-[var(--muted,#62685f)] sm:p-4">
        <p className="font-bold text-[var(--ink,#101310)]">
          {t("settings.evidence.contentsTitle")}
        </p>
        <p className="mt-1">{t("settings.evidence.contents")}</p>
        <p className="mt-2">{t("settings.evidence.verifyHint")}</p>
      </div>
    </section>
  );
}
