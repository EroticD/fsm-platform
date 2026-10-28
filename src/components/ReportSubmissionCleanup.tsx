"use client";

import { useEffect } from "react";
import {
  clearDraftLocally,
  OUTBOX_CHANGED_EVENT,
  removeOutboxForReport,
} from "@/lib/offline/draft-outbox";

/**
 * Rydder lokal kladd og ventende outbox-oppføringer etter en vellykket
 * innsending. Rapporten er da signert på serveren, og en gammel lokal kladd må
 * aldri kunne gjenopprettes eller replayes over den.
 *
 * Komponenten rendres bare når retursiden har `?reportSubmitted=<templateId>`.
 */
export default function ReportSubmissionCleanup({
  userId,
  workOrderId,
  templateId,
}: {
  userId: string;
  workOrderId: string;
  templateId: string;
}) {
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await clearDraftLocally({ userId, workOrderId, templateId });
        await removeOutboxForReport({ workOrderId, templateId });
      } catch {
        // IndexedDB er utilgjengelig – serveren er uansett autoritativ.
      } finally {
        if (active) window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
      }
    })();

    // Fjern markøren fra adressefeltet, så en refresh ikke kjører ryddingen på nytt.
    const url = new URL(window.location.href);
    if (url.searchParams.get("reportSubmitted") === templateId) {
      url.searchParams.delete("reportSubmitted");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }

    return () => {
      active = false;
    };
  }, [templateId, userId, workOrderId]);

  return null;
}
