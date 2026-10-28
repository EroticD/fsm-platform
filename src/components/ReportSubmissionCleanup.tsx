"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { clearOfflinePageCache } from "@/lib/offline/cache";
import {
  clearDraftLocally,
  OUTBOX_CHANGED_EVENT,
  removeOutboxForReport,
} from "@/lib/offline/draft-outbox";

/**
 * Rydder lokal kladd og ventende outbox-oppføringer etter en vellykket
 * innsending, og viser en varig kvittering til montøren.
 *
 * Rapporten er signert på serveren, og en gammel lokal kladd må aldri kunne
 * gjenopprettes eller replayes over den. `?reportSubmitted` blir stående til
 * brukeren lukker kvitteringen, slik at en refresh viser den samme bekreftelsen.
 * Selve parameteren fjernes først ved lukking – da er ryddingen allerede gjort.
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
  const t = useTranslations("common");
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  // Oppdragssiden finnes både i feltportalen og på kontoret. Velg riktig
  // returmål ut fra hvor kvitteringen vises.
  const workOrderHref = pathname?.startsWith("/oppdrag/")
    ? `/oppdrag/${workOrderId}`
    : `/mine-oppdrag/${workOrderId}`;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await clearDraftLocally({ userId, workOrderId, templateId });
        await removeOutboxForReport({ workOrderId, templateId });
        // En cachet, utfylt side skal ikke kunne gjenåpnes offline etter at
        // rapporten er signert.
        await clearOfflinePageCache();
      } catch {
        // IndexedDB er utilgjengelig – serveren er uansett autoritativ.
      } finally {
        if (active) window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
      }
    })();

    return () => {
      active = false;
    };
  }, [templateId, userId, workOrderId]);

  const dismiss = () => {
    setVisible(false);
    const url = new URL(window.location.href);
    if (url.searchParams.get("reportSubmitted") === templateId) {
      url.searchParams.delete("reportSubmitted");
      window.history.replaceState(
        null,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  };

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border-2 border-green-300 bg-green-50 px-5 py-4 text-green-900"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="font-black">{t("orders.reportForm.submittedTitle")}</p>
          <p className="text-sm font-medium">
            {t("orders.reportForm.submittedText")}
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href={`/rapporter/${workOrderId}`}
              className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-800"
            >
              {t("orders.reportForm.submittedOpenPdf")}
            </Link>
            <Link
              href={workOrderHref}
              className="rounded-xl border-2 border-green-300 bg-white px-4 py-2 text-sm font-bold text-green-900 transition hover:bg-green-100"
            >
              {t("orders.reportForm.submittedOpenWorkOrder")}
            </Link>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="whitespace-nowrap rounded-lg bg-green-100 px-3 py-1.5 text-xs font-bold text-green-900 transition hover:bg-green-200"
        >
          {t("orders.reportForm.submittedDismiss")}
        </button>
      </div>
    </div>
  );
}
