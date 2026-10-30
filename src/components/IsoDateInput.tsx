"use client";

import { useId, useRef, useState, type InputHTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";

type IsoDateInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "defaultValue" | "value"
> & {
  /** ISO-dato på formen YYYY-MM-DD. */
  defaultValue?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Datofelt med ISO-visning uavhengig av nettleserens språk.
 *
 * Native `<input type="date">` viser datoen i nettleserens locale (ofte
 * MM/DD/YYYY). Dette feltet viser alltid YYYY-MM-DD, men beholder en skjult
 * native datovelger slik at kalenderknappen fortsatt fungerer på mobil og
 * desktop. Verdien som sendes i skjemaet er alltid ISO.
 */
export default function IsoDateInput({
  id,
  className = "",
  defaultValue = "",
  ...props
}: IsoDateInputProps) {
  const t = useTranslations("common");
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [value, setValue] = useState(defaultValue);
  const pickerRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const picker = pickerRef.current;
    if (!picker) return;
    if (typeof picker.showPicker === "function") {
      try {
        picker.showPicker();
        return;
      } catch {
        // Nettleseren kan kreve en annen brukeraktivering; fall tilbake.
      }
    }
    picker.focus();
    picker.click();
  }

  return (
    <div className="relative">
      <input
        {...props}
        id={inputId}
        type="text"
        inputMode="text"
        autoComplete="off"
        maxLength={10}
        placeholder="YYYY-MM-DD"
        pattern="\d{4}-\d{2}-\d{2}"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={`${className} pr-11`}
        aria-describedby={
          props["aria-describedby"]
            ? `${props["aria-describedby"]} ${inputId}-iso-hint`
            : `${inputId}-iso-hint`
        }
      />
      <span id={`${inputId}-iso-hint`} className="sr-only">
        {t("components.date.isoHint")}
      </span>
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={ISO_DATE.test(value) ? value : ""}
        onChange={(event) => setValue(event.target.value)}
        className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0"
      />
      <button
        type="button"
        onClick={openPicker}
        aria-label={t("components.date.openPicker")}
        title={t("components.date.openPicker")}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-[10px] text-[var(--muted,#62685f)] transition hover:bg-[var(--paper,#f2efe6)] hover:text-[var(--ink,#101310)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#101310)]"
      >
        <Icon name="calendar" className="h-4 w-4" />
      </button>
    </div>
  );
}
