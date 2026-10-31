"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import type { UnitStatus } from "./draft-restore";
import type { UnitCompletionNotice } from "./unit-completion";

/** Nok til å være tydelig med hansker, men kort nok til å unngå tjuvstart. */
const SWIPE_THRESHOLD = 84;
/** Bevegelser under dette er støy fra et vanlig trykk. */
const AXIS_SLOP = 8;

/**
 * Mobilhodet for en enhet: sveip høyre for å godkjenne, med en vanlig knapp
 * som tastatur- og skjermleserfallback. Komponenten skjules fra `sm` og opp,
 * slik at desktop fortsatt bare bruker radioknappene.
 */
export default function UnitCompletionHeader({
  unitNumber,
  status,
  notice,
  undoAvailable,
  onComplete,
  onUndo,
  onRemove,
}: {
  unitNumber: number;
  status: UnitStatus;
  notice?: UnitCompletionNotice;
  undoAvailable: boolean;
  onComplete: () => void;
  onUndo: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("common");
  const hintId = useId();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const axis = useRef<"x" | "y" | null>(null);
  // En sveip skal ikke etterlate seg et klikk på fjern-knappen eller hodet.
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const resetGesture = () => {
    start.current = null;
    axis.current = null;
    setDragging(false);
    setOffset(0);
  };

  const releaseCapture = (pointerId: number) => {
    const surface = surfaceRef.current;
    if (surface?.hasPointerCapture?.(pointerId)) {
      surface.releasePointerCapture(pointerId);
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Mus på smal skjerm skal også kunne dra, men bare med primærknappen.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // Knapper, lenker og skjemafelt eier sin egen gest. En sveip skal aldri
    // velge radio, åpne en lenke eller sende inn skjemaet.
    if (
      target?.closest(
        "input, textarea, select, button, a, label, summary, [role='button']",
      )
    ) {
      return;
    }
    start.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    axis.current = null;
    suppressClick.current = false;
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = start.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;

    if (axis.current === null) {
      if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return;
      // Vertikal bevegelse er rulling. Da avbrytes gesten før den kan fullføre.
      if (Math.abs(dy) >= Math.abs(dx)) {
        axis.current = "y";
        setOffset(0);
        return;
      }
      axis.current = "x";
      suppressClick.current = true;
      surfaceRef.current?.setPointerCapture?.(event.pointerId);
    }

    if (axis.current !== "x") return;
    // Bare høyre sveip teller. Venstre bevegelse skal ikke gi negativ progresjon.
    if (dx <= 0) {
      setOffset(0);
      return;
    }
    if (event.cancelable) event.preventDefault();
    setOffset(Math.min(dx, SWIPE_THRESHOLD * 1.2));
  };

  const finishGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = start.current;
    if (!gesture) return;
    const dx = event.clientX - gesture.x;
    // Også avvik og allerede godkjente enheter går gjennom samme vurdering,
    // slik at forklaringen blir lik for sveip og knapp.
    const shouldComplete = axis.current === "x" && dx >= SWIPE_THRESHOLD;
    const pointerId = gesture.pointerId;
    resetGesture();
    releaseCapture(pointerId);
    if (shouldComplete) onComplete();
  };

  const cancelGesture = () => {
    const pointerId = start.current?.pointerId;
    resetGesture();
    if (pointerId !== undefined) releaseCapture(pointerId);
  };

  const progress = Math.min(
    100,
    Math.round((offset / SWIPE_THRESHOLD) * 100),
  );
  const ready = progress >= 100;
  const hintText = dragging
    ? ready
      ? t("orders.reportForm.swipeReleaseHint")
      : t("orders.reportForm.swipeProgress", { percent: progress })
    : t("orders.reportForm.swipeCompleteHint");
  const noticeLines: string[] = [];
  if (notice?.kind === "missing") {
    noticeLines.push(
      t("orders.reportForm.swipeMissingAnswers", {
        count: notice.count,
        fields: notice.fields.join(", "),
      }),
    );
  } else if (notice?.kind === "trigger") {
    noticeLines.push(
      t("orders.reportForm.swipeDeviationTrigger", {
        field: notice.field,
        value: notice.value,
      }),
    );
    if ((notice.missingCount ?? 0) > 0 && notice.missingFields) {
      noticeLines.push(
        t("orders.reportForm.swipeMissingAnswers", {
          count: notice.missingCount ?? 0,
          fields: notice.missingFields.join(", "),
        }),
      );
    }
  } else if (notice?.kind === "deviation") {
    noticeLines.push(t("orders.reportForm.swipeDeviationBlocked"));
  }

  return (
    <div className="sm:hidden">
      <div
        ref={surfaceRef}
        data-swipe-complete="true"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishGesture}
        onPointerCancel={cancelGesture}
        onClickCapture={(event) => {
          if (!suppressClick.current) return;
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        style={{
          touchAction: "pan-y",
          transform: offset > 0 ? `translateX(${offset}px)` : undefined,
          transition:
            dragging || reducedMotion ? "none" : "transform 140ms ease-out",
        }}
        className="relative select-none overflow-hidden rounded-xl"
      >
        {/* En smal progresstripe ligger bak hodet og avsløres etter hvert som
            raden skyves til høyre. Prosenten står som tekst, ikke bare farge. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 flex w-24 items-center justify-center gap-1.5 rounded-l-xl bg-signal/20 px-2 text-ink"
        >
          <Icon
            name={ready ? "check" : "arrowRight"}
            className="h-4 w-4 shrink-0"
          />
          <span className="text-[11px] font-black tabular-nums">
            {ready ? t("orders.reportForm.swipeReleaseShort") : `${progress} %`}
          </span>
        </div>

        <div className="relative flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-white/75 px-3">
          <h3 className="min-w-0 font-black text-ink">
            {t("orders.reportForm.unitTitle", { number: unitNumber })}
          </h3>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex min-h-12 shrink-0 items-center rounded-lg border border-risk/30 bg-risk/10 px-3 py-1.5 text-[11px] font-bold text-risk transition hover:bg-risk/15"
          >
            {t("orders.reportForm.removeUnit")}
          </button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p
          id={hintId}
          className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-gray-600"
        >
          <Icon
            name={dragging && ready ? "check" : "arrowRight"}
            className="h-3.5 w-3.5 shrink-0"
          />
          <span className="min-w-0">{hintText}</span>
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {status === "AVVIK" && (
            <span className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-risk/40 bg-risk/10 px-3 text-xs font-black text-risk">
              <Icon name="alert" className="h-4 w-4" />
              {t("orders.reportForm.deviation")}
            </span>
          )}
          {status === "GODKJENT" ? (
            <span className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border border-success/40 bg-success/10 px-3 text-xs font-black text-success">
              <Icon name="check" className="h-4 w-4" />
              {t("orders.reportForm.approved")}
            </span>
          ) : (
            <button
              type="button"
              onClick={onComplete}
              aria-describedby={hintId}
              className="inline-flex min-h-12 items-center gap-1.5 rounded-xl border-2 border-ink/20 bg-white px-3 text-xs font-black text-ink transition hover:border-ink/40 hover:bg-white/80"
            >
              <Icon name="check" className="h-4 w-4" />
              {t("orders.reportForm.completeUnit")}
            </button>
          )}
        </div>
      </div>

      {noticeLines.length > 0 && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-1.5 rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900"
        >
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {noticeLines.map((line, index) => (
              <span key={index} className="block">
                {line}
              </span>
            ))}
          </span>
        </div>
      )}

      {undoAvailable && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-1.5 text-success">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold">
            <Icon name="check" className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">
              {t("orders.reportForm.undoAnnouncement", {
                number: unitNumber,
              })}
            </span>
          </span>
          <button
            type="button"
            onClick={onUndo}
            className="inline-flex min-h-11 items-center rounded-lg border border-success/50 bg-white px-3 text-xs font-black text-success transition hover:bg-success/10"
          >
            {t("orders.reportForm.undoComplete")}
          </button>
        </div>
      )}
    </div>
  );
}
