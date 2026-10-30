"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { clearOfflinePage } from "@/lib/offline/cache";
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
  verified,
}: {
  userId: string;
  workOrderId: string;
  templateId: string;
  /**
   * Må være bekreftet av serveren: en låst rapport for denne malen finnes på
   * oppdraget. Query-parameteren alene er ikke nok.
   */
  verified: boolean;
}) {
  const t = useTranslations("common");
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  // Oppdragssiden finnes både i feltportalen og på kontoret. Velg riktig
  // returmål ut fra hvor kvitteringen vises.
  const workOrderHref = pathname?.startsWith("/oppdrag/")
    ? `/oppdrag/${workOrderId}`
    : `/mine-oppdrag/${workOrderId}`;
  // Feltportalen har en egen liste over neste oppdrag. Kontoret har ikke det
  // samme feltløpet, så der vises bare oppdraget og PDF-en.
  const isFieldPortal = pathname?.startsWith("/mine-oppdrag") ?? false;

  useEffect(() => {
    if (!verified) return;
    let active = true;
    void (async () => {
      try {
        await clearDraftLocally({ userId, workOrderId, templateId });
        await removeOutboxForReport({ workOrderId, templateId });
        // Bare det innsendte skjemaet skal bort. Andre cached forms og
        // oppdragssider må fortsatt kunne åpnes offline.
        await clearOfflinePage(
          userId,
          `/mine-oppdrag/${workOrderId}/skjema/${templateId}`,
        );
      } catch {
        // IndexedDB er utilgjengelig – serveren er uansett autoritativ.
      } finally {
        if (active) window.dispatchEvent(new Event(OUTBOX_CHANGED_EVENT));
      }
    })();

    return () => {
      active = false;
    };
  }, [templateId, userId, verified, workOrderId]);

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

  if (!verified || !visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-5 py-4 text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] [--focus-ring:var(--ink,#101310)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="flex items-center gap-2 font-black">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]">
              <Icon name="check" className="h-5 w-5" strokeWidth={2.4} />
            </span>
            {t("orders.reportForm.submittedTitle")}
          </p>
          <p className="text-sm font-medium text-[#2a2f28]">
            {t("orders.reportForm.submittedText")}
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {isFieldPortal && (
              <Link
                href="/mine-oppdrag"
                className="signal-button border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-sm text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] transition hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--ink,#101310)]"
              >
                {t("orders.reportForm.submittedNextAssignment")}
              </Link>
            )}
            <Link
              href={`/rapporter/${workOrderId}`}
              className={
                isFieldPortal
                  ? "ink-button text-sm"
                  : "signal-button border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-sm text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] transition hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--ink,#101310)]"
              }
            >
              {t("orders.reportForm.submittedOpenPdf")}
            </Link>
            <Link
              href={workOrderHref}
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--line,#dedcd1)] bg-transparent px-4 py-2 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
            >
              {t("orders.reportForm.submittedOpenWorkOrder")}
            </Link>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-[var(--line,#dedcd1)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
        >
          {t("orders.reportForm.submittedDismiss")}
        </button>
      </div>
    </div>
  );
}
