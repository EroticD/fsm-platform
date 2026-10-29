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
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const labelId = useId();
  const nameFieldId = useId();
  const drawHintId = useId();
  const [expanded, setExpanded] = useState(false);
  const [typedName, setTypedName] = useState("");
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

  /**
   * Tastaturvennlig alternativ til å tegne: navnet skrives inn og tegnes på et
   * eget lerret. Resultatet lagres i samme skjulte felt som en tegnet signatur,
   * så resten av rapportflyten er uendret.
   */
  const applyTypedSignature = () => {
    const name = typedName.trim();
    if (!name) return;

    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 220;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#111827";
    context.textBaseline = "middle";

    // Krymp skriften til navnet passer, uten å gjøre signaturen uleselig.
    let fontSize = 52;
    do {
      context.font = `italic ${fontSize}px "Segoe Script", "Bradley Hand", cursive`;
      if (context.measureText(name).width <= canvas.width - 80) break;
      fontSize -= 2;
    } while (fontSize > 20);
    context.fillText(name, 40, canvas.height / 2, canvas.width - 80);

    padRef.current?.clear();
    setDataUrl(canvas.toDataURL("image/png"));
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

  // Lås sidebakgrunnen, hold fokus innenfor fullskjermen og gi Escape en vei ut.
  // Når fullskjermen lukkes, flyttes fokus tilbake til utvid-knappen.
  useEffect(() => {
    if (!expanded) {
      if (restoreFocusRef.current) {
        restoreFocusRef.current = false;
        triggerRef.current?.focus({ preventScroll: true });
      }
      return;
    }

    restoreFocusRef.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    triggerRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
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
      ref={dialogRef}
      className={
        expanded
          ? "field-app fixed inset-0 z-[80] flex flex-col gap-3 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]"
          : "space-y-2 text-ink"
      }
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? true : undefined}
      aria-labelledby={expanded ? labelId : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          id={labelId}
          className={`block text-sm font-black ${
            expanded ? "text-paper" : "text-ink"
          }`}
        >
          {label}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {dataUrl && (
            <button
              type="button"
              onClick={clear}
              className={`inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-bold transition ${
                expanded
                  ? "bg-white/10 text-paper hover:bg-white/20"
                  : "bg-white/50 text-ink hover:bg-white/70"
              }`}
            >
              🧹 {t("components.signature.clear")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            ref={triggerRef}
            className={`inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-bold transition ${
              expanded
                ? "signal-button"
                : "border border-line bg-white text-ink hover:bg-white"
            }`}
          >
            {expanded
              ? `✕ ${t("components.signature.closeFullscreen")}`
              : t("components.signature.fullscreen")}
          </button>
        </div>
      </div>

      {helperText && (
        <p
          className={`text-xs ${
            expanded ? "text-paper/70" : "text-muted"
          }`}
        >
          {helperText}
        </p>
      )}

      {expanded && (
        <div className="space-y-1 text-xs font-bold text-paper/70">
          <p>{t("components.signature.landscapeHint")}</p>
          <p>{t("p3.signature.focusHint")}</p>
        </div>
      )}

      {existingUrl && showExisting && (
        <div className="rounded-xl border-2 border-line bg-paper p-3 text-ink">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-muted">
            {t("components.signature.previous")}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={existingUrl}
            alt={t("components.signature.previousAlt", { label })}
            className="h-16 object-contain"
          />
          <p className="mt-2 text-xs text-muted">
            {t("components.signature.keep")}
          </p>
        </div>
      )}

      <div
        ref={canvasWrapRef}
        className={
          expanded
            ? "min-h-[180px] flex-1 rounded-xl border-2 border-dashed border-signal/50 bg-white shadow-[0_18px_40px_rgba(0,0,0,0.24)]"
            : "overflow-hidden rounded-xl border-2 border-dashed border-line bg-white"
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
            "aria-describedby": drawHintId,
          }}
          onEnd={handleEnd}
        />
      </div>

      <p
        id={drawHintId}
        className={`text-xs ${expanded ? "text-paper/70" : "text-muted"}`}
      >
        {t("components.signature.drawHint")} {t("p3.signature.pointerHint")}
      </p>

      {/* Tastaturalternativ: tegneflaten er pointer-basert, men navnet kan
          skrives inn og gjøres om til en signatur uten mus eller finger. */}
      <details
        className={`rounded-xl border p-3 ${
          expanded
            ? "border-[#2a3328] bg-field-card"
            : "border-line bg-white/50"
        }`}
      >
        <summary
          className={`cursor-pointer text-xs font-bold ${
            expanded ? "text-paper" : "text-ink"
          }`}
        >
          ⌨️ {t("p3.signature.keyboardFallback")}
        </summary>
        <p
          className={`mt-2 text-xs ${
            expanded ? "text-paper/70" : "text-muted"
          }`}
        >
          {t("p3.signature.keyboardHint")}
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            aria-label={t("p3.signature.keyboardLabel")}
            placeholder={t("p3.signature.keyboardPlaceholder")}
            className={`min-w-0 flex-1 rounded-xl border-2 p-2.5 text-base font-bold sm:text-sm ${
              expanded
                ? "border-[#2a3328] bg-field text-paper placeholder:text-paper/65! focus:border-signal"
                : "border-line bg-white text-ink focus:border-success"
            }`}
          />
          <button
            type="button"
            onClick={applyTypedSignature}
            disabled={typedName.trim() === ""}
            className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
              expanded
                ? "signal-button"
                : "ink-button"
            }`}
          >
            {t("p3.signature.keyboardApply")}
          </button>
        </div>
      </details>

      {nameFieldName && (
        <div className="space-y-1">
          <label
            htmlFor={nameFieldId}
            className={`block text-xs font-bold ${
              expanded ? "text-paper/90" : "text-ink"
            }`}
          >
            {t("components.signature.nameLabel")}
          </label>
          <input
            id={nameFieldId}
            type="text"
            name={nameFieldName}
            defaultValue={defaultName || ""}
            placeholder={t("components.signature.namePlaceholder")}
            className={`w-full rounded-xl border-2 p-2.5 text-base font-bold sm:text-sm ${
              expanded
                ? "border-[#2a3328] bg-field-card text-paper placeholder:text-paper/65! focus:border-signal"
                : "border-line bg-white text-ink focus:border-success"
            }`}
          />
        </div>
      )}

      {/* Selve signaturen som bilde */}
      <input type="hidden" name={name} value={dataUrl} />

      {dataUrl ? (
        <p
          className={`text-xs font-bold ${
            expanded ? "text-signal" : "text-success"
          }`}
        >
          {t("components.signature.registered")}
        </p>
      ) : existingUrl ? (
        <p
          className={`text-xs ${
            expanded ? "text-paper/70" : "text-muted"
          }`}
        >
          {t("components.signature.keepHint")}
        </p>
      ) : (
        <p
          className={`text-xs ${
            expanded ? "text-paper/70" : "text-muted"
          }`}
        >
          {t("components.signature.notSigned")}
        </p>
      )}
    </div>
  );
}
