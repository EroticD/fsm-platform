"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import ImageUploadField from "@/components/ImageUploadField";
import MarkdownEditor from "@/components/MarkdownEditor";
import {
  commentTriggerOptions,
  fieldOptions,
  parseImageUrls,
} from "@/lib/report-answers";

export type TemplateField = {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
  /** For tilstandsfelt: valgene som krever kommentar. */
  commentOptions?: string[];
  /** Vis feltet bare når et annet felt i samme enhet har denne verdien. */
  conditionalFieldId?: string;
  conditionalValue?: string;
};

const inputClass =
  "w-full border-2 border-gray-300 p-3 rounded-xl text-base sm:text-sm font-bold text-gray-900 bg-gray-50 outline-none focus:border-blue-700";

/** Gjør en lagret svarverdi om til tekst, slik at den kan vises i et felt. */
function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Tilstandsfelt: flere valg (OK / Avvik / Utbedres / …). Velger man et valg som
 * krever oppfølging, dukker det opp et kommentarfelt for den samme linjen, og
 * feltet er påkrevd før skjemaet kan lagres.
 */
function StatusInput({
  field,
  name,
  commentName,
  defaultValue,
  defaultComment,
  onNeedsComment,
  onValueChange,
}: {
  field: TemplateField;
  name: string;
  commentName: string;
  defaultValue?: unknown;
  defaultComment?: string;
  /** Sier fra til skjemaet når denne linjen krever en kommentar (brukes til advarsler). */
  onNeedsComment?: (needs: boolean) => void;
  onValueChange?: (value: string) => void;
}) {
  const options = fieldOptions(field);
  const triggers = commentTriggerOptions(field);
  const t = useTranslations("common");
  const [value, setValue] = useState(asText(defaultValue));
  const mustComment = triggers.includes(value);

  // Rapporterer tilstanden både ved første visning (f.eks. en opplåst rapport)
  // og hver gang montøren endrer valget.
  useEffect(() => {
    onNeedsComment?.(triggers.includes(value));
  }, [value, triggers, onNeedsComment]);

  return (
    <fieldset className="bg-blue-50 p-4 rounded-xl border-2 border-blue-200 space-y-3">
      <legend className="block text-sm font-black text-gray-900">
        🧭 {field.label} {field.required && <span className="text-red-500">*</span>}
      </legend>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map((option, index) => {
          const selected = value === option;
          const negative = triggers.includes(option);
          const box = selected
            ? negative
              ? "border-red-500 bg-red-50"
              : "border-green-600 bg-green-50"
            : "border-gray-300 bg-white hover:bg-gray-50";
          return (
            <label
              key={option}
              className={`flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer transition ${box}`}
            >
              <input
                type="radio"
                name={name}
                value={option}
                checked={selected}
                // Påkrevd gruppe: én av radioene i gruppen må velges.
                required={field.required && index === 0}
                onChange={() => {
                  setValue(option);
                  onValueChange?.(option);
                }}
                className="w-5 h-5 text-blue-700"
              />
              <span className="font-bold text-gray-900 text-sm">{option}</span>
            </label>
          );
        })}
      </div>

      {mustComment ? (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3">
          <label htmlFor={`${commentName}-comment`} className="block text-[11px] font-black uppercase tracking-wider text-amber-900 mb-2">
            {t("orders.fieldInput.commentRequired", { value })}
          </label>
          <MarkdownEditor
            id={`${commentName}-comment`}
            name={commentName}
            required
            rows={3}
            defaultValue={defaultComment}
            placeholder={t("orders.fieldInput.commentPlaceholder")}
          />
        </div>
      ) : (
        <input type="hidden" name={commentName} value="" />
      )}
    </fieldset>
  );
}

/**
 * Tegner ett sjekkpunkt fra malen. `name` er navnet feltet får i skjemaet, og
 * inneholder både enheten og felt-id-en (f.eks. `answer__unit-0__c06lcxq`).
 * `defaultValue` brukes når en opplåst rapport redigeres på nytt.
 */
export default function FieldInput({
  field,
  name,
  commentName,
  defaultValue,
  defaultComment,
  onNeedsComment,
  onValueChange,
  workOrderId,
  anchorId,
}: {
  field: TemplateField;
  name: string;
  /** Navnet kommentaren på linjen får (bare for tilstandsfelt). */
  commentName?: string;
  defaultValue?: unknown;
  defaultComment?: string;
  /** Varsler skjemaet når linjen krever kommentar (bare for tilstandsfelt). */
  onNeedsComment?: (needs: boolean) => void;
  /** Varsler skjemaet om svaret, slik at betingede felt kan vises/skjules. */
  onValueChange?: (value: string) => void;
  /** Knytter opplastede bilder til oppdraget, slik at tilgangen kan styres. */
  workOrderId?: string;
  /** Valgfri anker-id, slik at stegstripen kan hoppe direkte til bildene. */
  anchorId?: string;
}) {
  const t = useTranslations("common");
  const fieldId = useId();
  switch (field.type) {
    case "CHECKBOX":
      return (
        <label className="flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl cursor-pointer hover:bg-blue-50 transition bg-gray-50">
          <input
            type="checkbox"
            name={name}
            value="on"
            defaultChecked={
              defaultValue === true ||
              defaultValue === "true" ||
              // Skjemaets FormData lagrer avkrysning som «on». Kladder kan
              // derfor inneholde denne verdien i tillegg til React-state.
              defaultValue === "on"
            }
            required={field.required}
            onChange={(event) =>
              onValueChange?.(event.target.checked ? "true" : "false")
            }
            className="w-6 h-6 text-blue-700 rounded border-gray-300 focus:ring-blue-700"
          />
          <span className="font-bold text-gray-900">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </span>
        </label>
      );

    case "STATUS":
      return (
        <StatusInput
          field={field}
          name={name}
          commentName={commentName ?? `${name}__kommentar`}
          defaultValue={defaultValue}
          defaultComment={defaultComment}
          onNeedsComment={onNeedsComment}
          onValueChange={onValueChange}
        />
      );

    case "TEXTAREA":
      return (
        <div>
          <label htmlFor={`${fieldId}-textarea`} className="block text-sm font-black text-gray-900 mb-2">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <MarkdownEditor
            id={`${fieldId}-textarea`}
            name={name}
            rows={3}
            required={field.required}
            defaultValue={asText(defaultValue)}
            placeholder={t("orders.fieldInput.textareaPlaceholder")}
            onChange={onValueChange}
          />
        </div>
      );

    case "NUMBER":
      return (
        <div>
          <label htmlFor={`${fieldId}-number`} className="block text-sm font-black text-gray-900 mb-2">
            🔢 {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <input
            id={`${fieldId}-number`}
            type="number"
            step="any"
            name={name}
            required={field.required}
            defaultValue={asText(defaultValue)}
            placeholder={t("orders.fieldInput.numberPlaceholder")}
            onChange={(event) => onValueChange?.(event.target.value)}
            className={inputClass}
          />
        </div>
      );

    case "DATE":
      return (
        <div>
          <label htmlFor={`${fieldId}-date`} className="block text-sm font-black text-gray-900 mb-2">
            📅 {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <input
            id={`${fieldId}-date`}
            type="date"
            name={name}
            required={field.required}
            defaultValue={asText(defaultValue)}
            onChange={(event) => onValueChange?.(event.target.value)}
            className={inputClass}
          />
        </div>
      );

    case "SELECT":
      return (
        <div>
          <label htmlFor={`${fieldId}-select`} className="block text-sm font-black text-gray-900 mb-2">
            📂 {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <select
            id={`${fieldId}-select`}
            name={name}
            required={field.required}
            defaultValue={asText(defaultValue)}
            onChange={(event) => onValueChange?.(event.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              {t("orders.fieldInput.selectPlaceholder")}
            </option>
            {field.options?.map((opt, i) => (
              <option key={i} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );

    case "IMAGE":
      return (
        <div id={anchorId} className={anchorId ? "scroll-mt-24" : undefined}>
          <ImageUploadField
            name={name}
            label={field.label}
            required={field.required}
            initialUrls={parseImageUrls(defaultValue)}
            workOrderId={workOrderId}
          />
        </div>
      );

    case "SIGNATURE":
      return (
        <div>
          <label htmlFor={`${fieldId}-signature`} className="block text-sm font-black text-gray-900 mb-2">
            ✍️ {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <input
            id={`${fieldId}-signature`}
            type="text"
            name={name}
            required={field.required}
            defaultValue={asText(defaultValue)}
            placeholder={t("orders.fieldInput.signaturePlaceholder")}
            onChange={(event) => onValueChange?.(event.target.value)}
            className="w-full border-2 border-dashed border-blue-400 p-4 rounded-xl text-base sm:text-sm font-bold text-gray-900 bg-blue-50/50 outline-none focus:border-blue-700"
          />
        </div>
      );

    default:
      return (
        <div>
          <label htmlFor={`${fieldId}-text`} className="block text-sm font-black text-gray-900 mb-2">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <input
            id={`${fieldId}-text`}
            type="text"
            name={name}
            required={field.required}
            defaultValue={asText(defaultValue)}
            placeholder={t("orders.fieldInput.textPlaceholder")}
            onChange={(event) => onValueChange?.(event.target.value)}
            className={inputClass}
          />
        </div>
      );
  }
}
