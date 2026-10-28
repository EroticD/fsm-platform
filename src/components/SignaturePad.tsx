"use client";

import { useRef, useState } from "react";
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-sm font-black text-gray-900">{label}</label>
        {dataUrl && (
          <button
            type="button"
            onClick={clear}
            className="text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-lg transition whitespace-nowrap"
          >
            🧹 {t("components.signature.clear")}
          </button>
        )}
      </div>

      {helperText && <p className="text-xs text-gray-500">{helperText}</p>}

      {existingUrl && showExisting && (
        <div className="border-2 border-gray-200 rounded-xl bg-white p-3">
          <p className="text-xs font-black uppercase tracking-wider text-gray-500 mb-2">
            {t("components.signature.previous")}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={existingUrl} alt={t("components.signature.previousAlt", { label })} className="h-16 object-contain" />
          <p className="text-xs text-gray-500 mt-2">
            {t("components.signature.keep")}
          </p>
        </div>
      )}

      <div className="border-2 border-dashed border-gray-300 rounded-xl bg-white overflow-hidden">
        <SignatureCanvas
          ref={padRef}
          penColor="#111827"
          clearOnResize={false}
          canvasProps={{
            className: "block w-full h-32 sm:h-40",
            "aria-label": label,
          }}
          onEnd={handleEnd}
        />
      </div>

      {nameFieldName && (
        <input
          type="text"
          name={nameFieldName}
          defaultValue={defaultName || ""}
          placeholder={t("components.signature.namePlaceholder")}
          className="w-full border-2 border-gray-300 p-2.5 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 focus:border-blue-700"
        />
      )}

      {/* Selve signaturen som bilde */}
      <input type="hidden" name={name} value={dataUrl} />

      {dataUrl ? (
        <p className="text-xs font-bold text-green-700">{t("components.signature.registered")}</p>
      ) : existingUrl ? (
        <p className="text-xs text-gray-400">{t("components.signature.keepHint")}</p>
      ) : (
        <p className="text-xs text-gray-400">{t("components.signature.notSigned")}</p>
      )}
    </div>
  );
}
