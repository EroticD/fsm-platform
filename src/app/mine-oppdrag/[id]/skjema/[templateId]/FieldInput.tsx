"use client";

import { useEffect, useState } from "react";
import ImageUploadField from "@/components/ImageUploadField";
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
};

const inputClass =
  "w-full border-2 border-gray-300 p-3 rounded-xl text-sm font-bold text-gray-900 bg-gray-50 outline-none focus:border-blue-700";

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
}: {
  field: TemplateField;
  name: string;
  commentName: string;
  defaultValue?: unknown;
  defaultComment?: string;
  /** Sier fra til skjemaet når denne linjen krever en kommentar (brukes til advarsler). */
  onNeedsComment?: (needs: boolean) => void;
}) {
  const options = fieldOptions(field);
  const triggers = commentTriggerOptions(field);
  const [value, setValue] = useState(asText(defaultValue));
  const [comment, setComment] = useState(defaultComment ?? "");
  const mustComment = triggers.includes(value);

  // Rapporterer tilstanden både ved første visning (f.eks. en opplåst rapport)
  // og hver gang montøren endrer valget.
  useEffect(() => {
    onNeedsComment?.(triggers.includes(value));
  }, [value, triggers, onNeedsComment]);

  return (
    <div className="bg-blue-50 p-4 rounded-xl border-2 border-blue-200 space-y-3">
      <label className="block text-sm font-black text-gray-900">
        🧭 {field.label} {field.required && <span className="text-red-500">*</span>}
      </label>

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
                onChange={() => setValue(option)}
                className="w-5 h-5 text-blue-700"
              />
              <span className="font-bold text-gray-900 text-sm">{option}</span>
            </label>
          );
        })}
      </div>

      {mustComment ? (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3">
          <label className="block text-[11px] font-black uppercase tracking-wider text-amber-900 mb-2">
            💬 Kommentar til «{value}» – påkrevd
          </label>
          <textarea
            name={commentName}
            required
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Beskriv avviket eller hva som må utbedres på denne linjen ..."
            className="w-full border-2 border-amber-300 p-3 rounded-xl text-sm font-bold text-gray-900 bg-white outline-none focus:border-amber-600"
          />
        </div>
      ) : (
        <input type="hidden" name={commentName} value="" />
      )}
    </div>
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
}: {
  field: TemplateField;
  name: string;
  /** Navnet kommentaren på linjen får (bare for tilstandsfelt). */
  commentName?: string;
  defaultValue?: unknown;
  defaultComment?: string;
  /** Varsler skjemaet når linjen krever kommentar (bare for tilstandsfelt). */
  onNeedsComment?: (needs: boolean) => void;
}) {
  switch (field.type) {
    case "CHECKBOX":
      return (
        <label className="flex items-center gap-3 p-4 border-2 border-gray-200 rounded-xl cursor-pointer hover:bg-blue-50 transition bg-gray-50">
          <input
            type="checkbox"
            name={name}
            value="on"
            defaultChecked={defaultValue === true || defaultValue === "true"}
            required={field.required}
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
        />
      );

    case "TEXTAREA":
      return (
        <div>
          <label className="block text-sm font-black text-gray-900 mb-2">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <textarea
            name={name}
            rows={3}
            required={field.required}
            defaultValue={asText(defaultValue)}
            placeholder="Utdypende svar..."
            className={inputClass}
          />
        </div>
      );

    case "NUMBER":
      return (
        <div>
          <label className="block text-sm font-black text-gray-900 mb-2">
            🔢 {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <input
            type="number"
            step="any"
            name={name}
            required={field.required}
            defaultValue={asText(defaultValue)}
            placeholder="Skriv inn tallverdi..."
            className={inputClass}
          />
        </div>
      );

    case "DATE":
      return (
        <div>
          <label className="block text-sm font-black text-gray-900 mb-2">
            📅 {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <input type="date" name={name} required={field.required} defaultValue={asText(defaultValue)} className={inputClass} />
        </div>
      );

    case "SELECT":
      return (
        <div>
          <label className="block text-sm font-black text-gray-900 mb-2">
            📂 {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <select name={name} required={field.required} defaultValue={asText(defaultValue)} className={inputClass}>
            <option value="" disabled>
              -- Velg alternativ --
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
        <ImageUploadField
          name={name}
          label={field.label}
          required={field.required}
          initialUrls={parseImageUrls(defaultValue)}
        />
      );

    case "SIGNATURE":
      return (
        <div>
          <label className="block text-sm font-black text-gray-900 mb-2">
            ✍️ {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <input
            type="text"
            name={name}
            required={field.required}
            defaultValue={asText(defaultValue)}
            placeholder="Skriv fullt navn som digital signatur"
            className="w-full border-2 border-dashed border-blue-400 p-4 rounded-xl text-sm font-bold text-gray-900 bg-blue-50/50 outline-none focus:border-blue-700"
          />
        </div>
      );

    default:
      return (
        <div>
          <label className="block text-sm font-black text-gray-900 mb-2">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          <input
            type="text"
            name={name}
            required={field.required}
            defaultValue={asText(defaultValue)}
            placeholder="Skriv her..."
            className={inputClass}
          />
        </div>
      );
  }
}
