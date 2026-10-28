"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import SignatureCanvas from "react-signature-canvas";

/**
 * Signaturfelt som tegnes med finger eller mus.
 *
 * Signaturen lagres som et PNG-bilde (data-URL) i et skjult felt med navnet
 * `name`, slik at server action-en kan ta den imot på samme måte som andre felt.
 *
 * `existingUrl` brukes når en opplåst rapport redigeres: den gamle signaturen
 * vises, og blir beholdt dersom man ikke signerer på nytt.
 *
 * Lerretet kan åpnes i fullskjerm. Det er samme canvas-instans hele tiden, slik
 * at streken beholdes når flaten endrer størrelse (rotasjon, fullskjerm eller
 * vindusendring). ResizeObserveren tilpasser pikselforholdet og tegner punktene
 * på nytt.
 */
export default function SignaturePad({
  name,
  label,
  nameFieldName,
  defaultName,
  helperText,
  existingUrl,
  initialDataUrl,
}: {
  name: string;
  label: string;
  /** Navn på det valgfrie tekstfeltet ved siden av signaturen. */
  nameFieldName?: string;
  defaultName?: string;
  helperText?: string;
  /** Signatur som allerede ligger på rapporten (fra en tidligere utfylling). */
  existingUrl?: string | null;
  /**
   * Signatur som allerede er tegnet, men som ennå bare finnes lokalt (f.eks. i
   * en gjenopprettet kladd). Legges i skjemaet slik at den ikke går tapt.
   */
  initialDataUrl?: string;
}) {
  const t = useTranslations("common");
  const padRef = useRef<SignatureCanvas>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const nameFieldId = useId();
  const [expanded, setExpanded] = useState(false);
  const [dataUrl, setDataUrl] = useState(initialDataUrl ?? "");
  // Den gjenopprettede signaturen vises som «tidligere» helt til montøren
  // tegner en ny.
  const [showExisting, setShowExisting] = useState(
    Boolean(initialDataUrl || existingUrl),
  );

  const handleEnd = () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      setDataUrl("");
      return;
    }
    // Trimmet versjon kutter bort tomrom rundt streken og gir et lite bilde.
    setDataUrl(pad.getTrimmedCanvas().toDataURL("image/png"));
    setShowExisting(false);
  };

  const clear = () => {
    padRef.current?.clear();
    setDataUrl("");
    setShowExisting(false);
  };

  // Re-initialiser lerretet når flaten endrer størrelse (rotasjon, fullskjerm
  // eller vindusendring), men behold det som er tegnet.
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;

    let frame = 0;
    const resize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const pad = padRef.current;
        const wrap = canvasWrapRef.current;
        if (!pad || !wrap) return;

        const canvas = pad.getCanvas();
        if (wrap.clientWidth === 0 || wrap.clientHeight === 0) return;

        const points = pad.toData();
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = Math.max(1, Math.round(wrap.clientWidth * ratio));
        canvas.height = Math.max(1, Math.round(wrap.clientHeight * ratio));
        const context = canvas.getContext("2d");
        if (context) context.scale(ratio, ratio);

        pad.clear();
        if (points.length > 0) pad.fromData(points);
      });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    window.addEventListener("orientationchange", resize);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("orientationchange", resize);
    };
  }, []);

  // Lås sidebakgrunnen og gi Escape en vei ut av fullskjermen.
  useEffect(() => {
    if (!expanded) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  return (
    <div
      className={
        expanded
          ? "fixed inset-0 z-[80] flex flex-col gap-3 overflow-y-auto bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
          : "space-y-2"
      }
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? true : undefined}
      aria-labelledby={expanded ? labelId : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          id={labelId}
          className="block text-sm font-black text-gray-900"
        >
          {label}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {dataUrl && (
            <button
              type="button"
              onClick={clear}
              className="inline-flex min-h-11 items-center rounded-lg bg-gray-100 px-3 text-xs font-bold text-gray-700 transition hover:bg-gray-200"
            >
              🧹 {t("components.signature.clear")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            ref={expanded ? closeButtonRef : undefined}
            className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-3 text-xs font-bold text-gray-800 transition hover:bg-gray-50"
          >
            {expanded
              ? `✕ ${t("components.signature.closeFullscreen")}`
              : t("components.signature.fullscreen")}
          </button>
        </div>
      </div>

      {helperText && <p className="text-xs text-gray-600">{helperText}</p>}

      {expanded && (
        <p className="text-xs font-bold text-gray-600">
          {t("components.signature.landscapeHint")}
        </p>
      )}

      {existingUrl && showExisting && (
        <div className="rounded-xl border-2 border-gray-200 bg-white p-3">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-gray-600">
            {t("components.signature.previous")}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={existingUrl}
            alt={t("components.signature.previousAlt", { label })}
            className="h-16 object-contain"
          />
          <p className="mt-2 text-xs text-gray-600">
            {t("components.signature.keep")}
          </p>
        </div>
      )}

      <div
        ref={canvasWrapRef}
        className={
          expanded
            ? "min-h-[180px] flex-1 rounded-xl border-2 border-dashed border-gray-300 bg-white"
            : "overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-white"
        }
      >
        <SignatureCanvas
          ref={padRef}
          penColor="#111827"
          clearOnResize={false}
          canvasProps={{
            className: expanded
              ? "block h-full min-h-[180px] w-full"
              : "block h-48 w-full sm:h-56",
            style: { touchAction: "none" },
            "aria-label": label,
          }}
          onEnd={handleEnd}
        />
      </div>

      <p className="text-xs text-gray-600">
        {t("components.signature.drawHint")}
      </p>

      {nameFieldName && (
        <div className="space-y-1">
          <label
            htmlFor={nameFieldId}
            className="block text-xs font-bold text-gray-700"
          >
            {t("components.signature.nameLabel")}
          </label>
          <input
            id={nameFieldId}
            type="text"
            name={nameFieldName}
            defaultValue={defaultName || ""}
            placeholder={t("components.signature.namePlaceholder")}
            className="w-full rounded-xl border-2 border-gray-300 bg-gray-50 p-2.5 text-sm font-bold text-gray-900 focus:border-blue-700"
          />
        </div>
      )}

      {/* Selve signaturen som bilde */}
      <input type="hidden" name={name} value={dataUrl} />

      {dataUrl ? (
        <p className="text-xs font-bold text-green-700">
          {t("components.signature.registered")}
        </p>
      ) : existingUrl ? (
        <p className="text-xs text-gray-600">
          {t("components.signature.keepHint")}
        </p>
      ) : (
        <p className="text-xs text-gray-600">
          {t("components.signature.notSigned")}
        </p>
      )}
    </div>
  );
}
