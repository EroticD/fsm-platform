"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import BarcodeScanner from "@/components/scanner/BarcodeScanner";
import Icon from "@/components/icons";
import { addEquipmentQrCodeAction } from "@/app/enheter/actions";

/**
 * Skjema for å registrere en QR-kode som allerede sitter på utstyret.
 * Kameraet er bare en hjelp til å fylle feltet; manuell innliming virker alltid.
 */
export default function EquipmentQrCodeForm({
  equipmentId,
  customerId,
}: {
  equipmentId: string;
  customerId: string;
}) {
  const t = useTranslations("common");
  const valueId = useId();
  const labelId = useId();
  const [value, setValue] = useState("");
  const [source, setSource] = useState<"MANUAL" | "SCAN">("MANUAL");
  const [scanning, setScanning] = useState(false);

  function handleDetected(code: string) {
    setValue(code);
    setSource("SCAN");
    setScanning(false);
  }

  return (
    <form action={addEquipmentQrCodeAction} className="mt-4 space-y-3">
      <input type="hidden" name="id" value={equipmentId} />
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="source" value={source} />

      <div>
        <label
          htmlFor={valueId}
          className="block text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]"
        >
          {t("assets.externalQr.form.value")}
        </label>
        <input
          id={valueId}
          name="value"
          type="text"
          required
          maxLength={2048}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSource("MANUAL");
          }}
          placeholder={t("assets.externalQr.form.valuePlaceholder")}
          className="mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]"
        />
        <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
          {t("assets.externalQr.form.valueHint")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setScanning((current) => !current)}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
        >
          <Icon name={scanning ? "close" : "camera"} className="h-4 w-4" />
          {scanning
            ? t("assets.externalQr.form.cancelScan")
            : t("assets.externalQr.form.scan")}
        </button>
      </div>

      {scanning && (
        <div className="rounded-2xl bg-[#101310] p-3">
          <BarcodeScanner
            autoStart
            showManual={false}
            onDetected={handleDetected}
          />
        </div>
      )}

      <div>
        <label
          htmlFor={labelId}
          className="block text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]"
        >
          {t("assets.externalQr.form.label")}
        </label>
        <input
          id={labelId}
          name="label"
          type="text"
          maxLength={120}
          autoComplete="off"
          placeholder={t("assets.externalQr.form.labelPlaceholder")}
          className="mt-1 min-h-11 w-full rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-sm text-[var(--ink,#101310)] focus:border-[var(--ink,#101310)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]"
        />
      </div>

      <button
        type="submit"
        className="signal-button inline-flex min-h-11 items-center justify-center gap-1.5 border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-4 text-sm text-[var(--ink,#101310)]"
      >
        <Icon name="plus" className="h-4 w-4" />
        {t("assets.externalQr.form.submit")}
      </button>
    </form>
  );
}
