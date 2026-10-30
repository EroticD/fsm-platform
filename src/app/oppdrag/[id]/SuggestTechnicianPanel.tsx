"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import {
  assignSuggestedTechnicianAction,
  suggestTechniciansAction,
  type SuggestedTechnician,
} from "./dispatch-actions";

type VisitOption = {
  id: string;
  label: string;
};

/**
 * «Foreslå montør» på oppdragsdetaljen. Rangeringsresultatet hentes først når
 * brukeren ber om det, slik at en stor oppdragsside ikke betaler for scoring av
 * alle visiter. Selve tildelingen går gjennom den vanlige visittjenesten.
 */
export default function SuggestTechnicianPanel({
  workOrderId,
  visits,
}: {
  workOrderId: string;
  visits: VisitOption[];
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [pendingVisit, setPendingVisit] = useState<string | null>(null);
  const [pendingAssign, setPendingAssign] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<
    Record<string, SuggestedTechnician[]>
  >({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function suggest(visitId: string) {
    setPendingVisit(visitId);
    setErrors((current) => ({ ...current, [visitId]: "" }));
    const formData = new FormData();
    formData.set("workOrderId", workOrderId);
    formData.set("visitId", visitId);
    try {
      const result = await suggestTechniciansAction(formData);
      if (!result.ok) {
        setErrors((current) => ({ ...current, [visitId]: result.error }));
        return;
      }
      setCandidates((current) => ({
        ...current,
        [visitId]: result.candidates,
      }));
    } finally {
      setPendingVisit(null);
    }
  }

  async function assign(visitId: string, technicianId: string) {
    setPendingAssign(`${visitId}:${technicianId}`);
    const formData = new FormData();
    formData.set("workOrderId", workOrderId);
    formData.set("visitId", visitId);
    formData.set("technicianId", technicianId);
    try {
      const result = await assignSuggestedTechnicianAction(formData);
      if (!result.ok) {
        setErrors((current) => ({ ...current, [visitId]: result.error }));
        return;
      }
      router.refresh();
    } finally {
      setPendingAssign(null);
    }
  }

  if (visits.length === 0) return null;

  return (
    <section
      aria-labelledby="suggest-technician-title"
      className="mb-3 rounded-xl border border-[var(--line,#d8d3c5)] bg-white p-3"
    >
      <h3
        id="suggest-technician-title"
        className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-[#5e6356]"
      >
        <Icon name="users" className="h-4 w-4" />
        {t("calendar.dispatch.suggestTitle")}
      </h3>
      <p className="mt-1 text-xs font-medium text-[#5e6356]">
        {t("calendar.dispatch.suggestHint")}
      </p>

      <ul className="mt-2 space-y-3">
        {visits.map((visit) => {
          const rows = candidates[visit.id] ?? [];
          const error = errors[visit.id];
          return (
            <li key={visit.id} className="rounded-lg border border-[var(--line,#d8d3c5)] p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-xs font-bold text-[var(--ink,#131711)]">
                  {visit.label}
                </span>
                <button
                  type="button"
                  disabled={pendingVisit === visit.id}
                  onClick={() => void suggest(visit.id)}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[var(--ink,#131711)] bg-[var(--signal,#c8f135)] px-3 py-2 text-xs font-bold text-[var(--ink,#131711)] transition hover:opacity-85 disabled:opacity-50"
                >
                  <Icon name="search" className="h-4 w-4" />
                  {t("calendar.dispatch.suggestButton")}
                </button>
              </div>

              {error ? (
                <p role="alert" className="mt-1 text-xs font-bold text-[var(--risk-text,#b42318)]">
                  {t("calendar.dispatch.suggestError")}
                </p>
              ) : null}

              {rows.length > 0 ? (
                <ul className="mt-2 space-y-1" aria-live="polite">
                  {rows.map((candidate) => (
                    <li
                      key={candidate.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[var(--paper,#f2efe6)] px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-[var(--ink,#131711)]">
                          {candidate.name}{" "}
                          <span className="tabular-nums text-[#5e6356]">
                            {candidate.score}
                          </span>
                          {!candidate.eligible && candidate.excludedReason ? (
                            <span className="ml-1 font-medium italic text-[#5e6356]">
                              ({t(
                                `calendar.dispatch.excluded_${candidate.excludedReason}`,
                              )})
                            </span>
                          ) : null}
                        </p>
                        <p className="text-[11px] text-[#5e6356]">
                          {t("calendar.dispatch.scoreSkills")} {candidate.scoreSkills} ·{" "}
                          {t("calendar.dispatch.scoreDistance")} {candidate.scoreDistance} ·{" "}
                          {t("calendar.dispatch.scoreTravel")} {candidate.scoreTravel} ·{" "}
                          {t("calendar.dispatch.scoreFree")} {candidate.freeMinutes} ·{" "}
                          {t("calendar.dispatch.scoreSla")} {candidate.slaUrgency}
                        </p>
                      </div>
                      {candidate.eligible ? (
                        <button
                          type="button"
                          disabled={
                            pendingAssign === `${visit.id}:${candidate.id}`
                          }
                          onClick={() => void assign(visit.id, candidate.id)}
                          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--ink,#131711)] px-3 py-2 text-xs font-bold text-white transition hover:opacity-85 disabled:opacity-50"
                        >
                          {t("calendar.dispatch.assignCandidate")}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
