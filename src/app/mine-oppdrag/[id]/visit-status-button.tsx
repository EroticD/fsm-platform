"use client";

// i18n-ignore-file: standardtekstene under er midlertidige reserveverdier.
// Sidene kan sende inn lokaliserte tekster via `labels`; nøklene er ikke lagt
// inn i katalogmessage-filene ennå fordi denne endringen er begrenset til
// offline-laget og feltdetaljsiden.

import { useCallback, useEffect, useState, type FormEvent } from "react";
import SubmitButton from "@/components/SubmitButton";
import {
  flushVisitStatuses,
  listPendingVisitStatuses,
  queueVisitStatus,
  type OfflineVisitStatus,
  type PendingVisitStatus,
  type VisitStatusFlushResult,
  type VisitStatusSendResult,
} from "@/lib/offline/visit-status-outbox";
import { recordVisitStatusOfflineSafe, setVisitStatus } from "./actions";

/** Tekstene kan overstyres av siden når oversettelsesnøklene finnes. */
export type VisitStatusLabels = {
  /** «Registrert offline kl. {time} – sendes når du er online» */
  queued: string;
  sending: string;
  sent: string;
  failed: string;
  queueFailed: string;
};

const DEFAULT_LABELS: VisitStatusLabels = {
  queued: "Registrert offline kl. {time} – sendes når du er online",
  sending: "Sender …",
  sent: "Status er sendt.",
  failed:
    "Statusen kunne ikke sendes. Den ligger i køen og prøves igjen når nettet er tilbake.",
  queueFailed:
    "Kunne ikke registrere statusen uten nett. Prøv igjen når du har dekning.",
};

const TIME_FORMAT = new Intl.DateTimeFormat("nb-NO", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatTime(epoch: number): string {
  return TIME_FORMAT.format(new Date(epoch));
}

/**
 * Sender én køet registrering til serveractionen. Definert på modulnivå, slik
 * at køen får en stabil innsender og ikke en ny funksjon ved hver render.
 */
async function sendQueuedVisitStatus(
  item: PendingVisitStatus,
): Promise<VisitStatusSendResult> {
  return recordVisitStatusOfflineSafe({
    visitId: item.visitId,
    status: item.status,
    at: item.at,
  });
}

/**
 * Avreise og ankomst for dagens økt, med offline-kø.
 *
 * Skjemaet er et helt vanlig server-action-skjema når nettet er der: det
 * tidfester handlingen og redirecter til kvitteringen. Uten nett avbrytes
 * innsendingen, tidspunktet legges i IndexedDB-køen og kvitteringen vises ved
 * knappen – uten redirect. Køen tømmes når nettleseren melder at nettet er
 * tilbake, og serveren bruker montørens tidspunkt som `enRouteAt`/`onSiteAt`.
 *
 * Fullføring av økten er ikke med her; den krever rapport og PDF og går alltid
 * gjennom den vanlige, nettavhengige flyten.
 */
export default function VisitStatusButton({
  workOrderId,
  visitId,
  status,
  label,
  labels = DEFAULT_LABELS,
  className = "signal-button min-h-11 text-sm shadow-sm",
}: {
  workOrderId: string;
  visitId: string;
  status: OfflineVisitStatus;
  label: string;
  labels?: VisitStatusLabels;
  className?: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [tone, setTone] = useState<"info" | "success" | "error">("info");
  // Hindrer at et dobbeltklikk legger to registreringer med ulikt millisekund
  // i køen for samme handling.
  const [queueing, setQueueing] = useState(false);

  const fillTime = useCallback((template: string, at: number) => {
    return template.replace("{time}", formatTime(at));
  }, []);

  // En registrering som ligger i køen skal fortsatt vises som «registrert
  // offline» når siden lastes på nytt eller appen startes på nytt.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pending = await listPendingVisitStatuses();
      const mine = pending.find(
        (item) => item.visitId === visitId && item.status === status,
      );
      if (cancelled || !mine) return;
      setTone("info");
      setNotice(fillTime(labels.queued, mine.at));
    })();
    return () => {
      cancelled = true;
    };
  }, [fillTime, labels.queued, status, visitId]);

  // Tøm køen ved oppstart og hver gang nettet kommer tilbake. Serveractionen
  // revaliderer siden, så tidene og statusen oppdateres uten reload.
  useEffect(() => {
    let cancelled = false;

    const sync = async () => {
      let result: VisitStatusFlushResult;
      try {
        result = await flushVisitStatuses(sendQueuedVisitStatus);
      } catch {
        // Låst lagring eller utilgjengelig IndexedDB: prøv igjen senere.
        return;
      }
      if (cancelled || (result.sent === 0 && result.discarded === 0)) return;
      setTone(result.discarded > 0 ? "error" : "success");
      setNotice(result.discarded > 0 ? labels.failed : labels.sent);
    };

    if (typeof navigator !== "undefined" && navigator.onLine) void sync();
    const onOnline = () => void sync();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [labels.failed, labels.sent]);

  async function queueLocally(at: number) {
    if (queueing) return;
    setQueueing(true);
    try {
      const result = await queueVisitStatus({ visitId, status, at });
      if (result === "queued" || result === "duplicate") {
        setTone("info");
        setNotice(fillTime(labels.queued, at));
        return;
      }
      // Køen er utilgjengelig (eller tidspunktet er urimelig): da er
      // handlingen ikke registrert, og det må stå tydelig.
      setTone("error");
      setNotice(labels.queueFailed);
    } finally {
      setQueueing(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Tidspunktet settes ved trykk, ikke ved render: en side som har stått
    // åpen i en time skal fortsatt tidfeste handlingen riktig.
    const at = Date.now();
    const atInput = event.currentTarget.elements.namedItem("at");
    if (atInput instanceof HTMLInputElement) atInput.value = String(at);

    if (typeof navigator === "undefined" || navigator.onLine !== false) return;

    // Uten nett skal knappen aldri redirecte. Handlingen køes og kvitteres
    // lokalt, med montørens eget tidspunkt.
    event.preventDefault();
    void queueLocally(at);
  }

  return (
    <form
      action={setVisitStatus}
      onSubmit={onSubmit}
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <input type="hidden" name="visitId" value={visitId} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="at" defaultValue="" />
      <SubmitButton
        pendingLabel={labels.sending}
        className={className}
        disabled={queueing}
      >
        {label}
      </SubmitButton>
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className={`text-xs font-bold ${
            tone === "error" ? "text-risk" : "text-signal"
          }`}
        >
          {notice}
        </p>
      )}
    </form>
  );
}
