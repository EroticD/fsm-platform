"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { STATUS_DEFAULT_COMMENT_OPTIONS, STATUS_DEFAULT_OPTIONS } from "@/lib/report-answers";

export type FieldType =
  | "TEXT"
  | "TEXTAREA"
  | "CHECKBOX"
  | "SELECT"
  | "STATUS"
  | "NUMBER"
  | "SIGNATURE"
  | "IMAGE"
  | "DATE";

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  required: boolean;
  options?: string[]; // For SELECT og STATUS
  /** For STATUS: valgene som krever at montøren skriver en kommentar. */
  commentOptions?: string[];
  // IFTTT (Conditional Logic)
  conditionalFieldId?: string; // Hvilket felt må trigge dette?
  conditionalValue?: string;   // Hvilken verdi må det feltet ha for at dette skal vises?
}

const FIELD_TYPES: FieldType[] = [
  "CHECKBOX",
  "TEXT",
  "TEXTAREA",
  "SELECT",
  "STATUS",
  "NUMBER",
  "IMAGE",
  "DATE",
  "SIGNATURE",
];

/** Lager en kort, tilfeldig id for et nytt skjemafelt. */
function createFieldId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export default function TemplateBuilder({ 
  initialTitle, 
  initialReportName = "",
  initialDescription = "",
  initialCategory = "SERVICE",
  initialHmsType = "",
  initialRequiresUnits = true,
  hmsTypes = [],
  initialFieldsJson, 
  saveAction,
  templateId,
}: { 
  initialTitle: string; 
  initialReportName?: string;
  initialDescription?: string;
  initialCategory?: "SERVICE" | "HMS";
  initialHmsType?: string;
  initialRequiresUnits?: boolean;
  hmsTypes?: Array<{ value: string; label: string }>;
  initialFieldsJson: string; 
  saveAction: (formData: FormData) => Promise<void> | void;
  templateId: string;
}) {
  const t = useTranslations("common");
  const idPrefix = useId();
  const [title, setTitle] = useState(initialTitle);
  const [reportName, setReportName] = useState(initialReportName);
  const [description, setDescription] = useState(initialDescription);
  const [category, setCategory] = useState<"SERVICE" | "HMS">(initialCategory);
  const [hmsType, setHmsType] = useState(initialHmsType);
  const [requiresUnits, setRequiresUnits] = useState(initialRequiresUnits);
  
  const [fields, setFields] = useState<FormField[]>(() => {
    try {
      const parsed = JSON.parse(initialFieldsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const addField = (type: FieldType) => {
    const newField: FormField = {
      id: createFieldId(),
      type,
      label: "",
      required: false,
      options:
        type === "SELECT"
          ? [t("settings.templateBuilder.options.one"), t("settings.templateBuilder.options.two")]
          : type === "STATUS"
            ? [...STATUS_DEFAULT_OPTIONS]
            : undefined,
      commentOptions: type === "STATUS" ? [...STATUS_DEFAULT_COMMENT_OPTIONS] : undefined,
    };
    setFields([...fields, newField]);
  };

  const updateField = (id: string, updates: Partial<FormField>) => {
    setFields(fields.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const removeField = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
  };

  const moveField = (index: number, direction: "UP" | "DOWN") => {
    if (direction === "UP" && index > 0) {
      const newFields = [...fields];
      [newFields[index - 1], newFields[index]] = [newFields[index], newFields[index - 1]];
      setFields(newFields);
    } else if (direction === "DOWN" && index < fields.length - 1) {
      const newFields = [...fields];
      [newFields[index + 1], newFields[index]] = [newFields[index], newFields[index + 1]];
      setFields(newFields);
    }
  };

  const updateOptions = (id: string, optionsString: string) => {
    const options = optionsString.split(",").map(o => o.trim()).filter(Boolean);
    updateField(id, { options });
  };

  return (
    <form action={saveAction} className="bg-white p-6 md:p-8 rounded-2xl shadow-sm border-2 border-gray-200 space-y-8">
      
      <input type="hidden" name="fieldsJson" value={JSON.stringify(fields)} />
      <input type="hidden" name="id" value={templateId} />
      <input type="hidden" name="requiresUnits" value={requiresUnits ? "true" : "false"} />
      
      <div>
        <label htmlFor="template-builder-name" className="block text-sm font-black text-gray-900 mb-1">{t("settings.templateBuilder.name")}</label>
        <input 
          id="template-builder-name"
          type="text" 
          name="title" 
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required 
          className="w-full border-2 border-gray-300 p-3 rounded-xl text-lg text-gray-900 font-bold focus:border-blue-700 bg-white shadow-sm placeholder:text-gray-500"
        />
      </div>

      <div>
        <label htmlFor="template-builder-description" className="block text-sm font-black text-gray-900 mb-1">
          {t("settings.templateBuilder.description")}
        </label>
        <textarea
          id="template-builder-description"
          name="description"
          aria-describedby="template-builder-description-hint"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={t("settings.templates.descriptionPlaceholder")}
          className="w-full border-2 border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium focus:border-blue-700 bg-white shadow-sm placeholder:text-gray-500"
        />
        <p id="template-builder-description-hint" className="text-xs text-gray-500 mt-1">
          {t("settings.templateBuilder.descriptionHint")}
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="template-builder-category" className="block text-sm font-black text-gray-900 mb-1">
            {t("settings.templateBuilder.category")}
          </label>
          <select
            id="template-builder-category"
            name="category"
            value={category}
            onChange={(e) => {
              const next = e.target.value as "SERVICE" | "HMS";
              setCategory(next);
              if (next === "SERVICE") setHmsType("");
            }}
            className="w-full border-2 border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-bold focus:border-blue-700 bg-white shadow-sm"
          >
            <option value="SERVICE">{t("settings.templates.categories.SERVICE")}</option>
            <option value="HMS">{t("settings.templates.categories.HMS")}</option>
          </select>
        </div>

        {category === "HMS" && (
          <div>
            <label htmlFor="template-builder-hms-type" className="block text-sm font-black text-gray-900 mb-1">
              {t("settings.templateBuilder.hmsType")}
            </label>
            <select
              id="template-builder-hms-type"
              name="hmsType"
              aria-describedby="template-builder-hms-type-hint"
              value={hmsType}
              onChange={(e) => setHmsType(e.target.value)}
              required
              className="w-full border-2 border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-bold focus:border-blue-700 bg-white shadow-sm"
            >
              <option value="" disabled>
                {t("settings.templates.hmsTypePlaceholder")}
              </option>
              {hmsTypes.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p id="template-builder-hms-type-hint" className="text-xs text-gray-500 mt-1">
              {t("settings.templateBuilder.hmsTypeHint")}
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="template-builder-report-name" className="block text-sm font-black text-gray-900 mb-1">
            {t("settings.templateBuilder.reportName")}
          </label>
          <input
            id="template-builder-report-name"
            type="text"
            name="reportName"
            aria-describedby="template-builder-report-name-hint"
            value={reportName}
            onChange={(e) => setReportName(e.target.value)}
            placeholder={t("settings.templates.reportNamePlaceholder")}
            className="w-full border-2 border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-bold focus:border-blue-700 bg-white shadow-sm placeholder:text-gray-500"
          />
          <p id="template-builder-report-name-hint" className="text-xs text-gray-500 mt-1">{t("settings.templateBuilder.reportNameHint")}</p>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-bold text-gray-900 cursor-pointer">
            <input
              type="checkbox"
              checked={requiresUnits}
              onChange={(e) => setRequiresUnits(e.target.checked)}
              aria-describedby="template-builder-requires-units-hint"
              className="w-4 h-4 text-blue-700 rounded border-gray-400 focus:ring-blue-600 cursor-pointer"
            />
            {t("settings.templateBuilder.requiresUnits")}
          </label>
          <p id="template-builder-requires-units-hint" className="text-xs text-gray-500 mt-1">{t("settings.templateBuilder.requiresUnitsHint")}</p>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <h2 className="text-lg font-black text-gray-900 mb-4">{t("settings.templateBuilder.sectionTitle")}</h2>
        
        {fields.length === 0 ? (
          <div className="bg-blue-50 border-2 border-blue-200 p-8 rounded-xl text-center">
            <p className="text-blue-900 font-bold mb-1">{t("settings.templateBuilder.emptyTitle")}</p>
            <p className="text-sm text-blue-800 font-medium">{t("settings.templateBuilder.emptyDesc")}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {fields.map((field, index) => (
              <div key={field.id} className="bg-gray-50 border-2 border-gray-200 p-5 rounded-2xl group shadow-sm space-y-4">
                
                <div className="flex gap-4 items-start">
                  {/* Pil opp/ned */}
                  <div className="flex flex-col gap-1 mt-1">
                    <button 
                      type="button" 
                      onClick={() => moveField(index, "UP")} 
                      disabled={index === 0} 
                      aria-label={t("settings.templateBuilder.moveUp")}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-gray-300 bg-white p-1 text-gray-700 transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 disabled:hover:bg-white"
                      title={t("settings.templateBuilder.moveUp")}
                    >
                      ▲
                    </button>
                    <button 
                      type="button" 
                      onClick={() => moveField(index, "DOWN")} 
                      disabled={index === fields.length - 1} 
                      aria-label={t("settings.templateBuilder.moveDown")}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-gray-300 bg-white p-1 text-gray-700 transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 disabled:hover:bg-white"
                      title={t("settings.templateBuilder.moveDown")}
                    >
                      ▼
                    </button>
                  </div>

                  <div className="flex-1 space-y-3">
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <span className="text-xs font-black text-blue-900 bg-blue-100 border border-blue-200 px-3 py-1 rounded-md uppercase tracking-wider">
                        {t(`settings.templateBuilder.types.${field.type}`)}
                      </span>
                      
                      <label className="flex items-center gap-2 text-sm font-bold text-gray-900 cursor-pointer hover:bg-gray-200 px-2 py-1 rounded transition">
                        <input 
                          type="checkbox" 
                          checked={field.required} 
                          onChange={(e) => updateField(field.id, { required: e.target.checked })} 
                          className="w-4 h-4 text-blue-700 rounded border-gray-400 focus:ring-blue-600 cursor-pointer" 
                        />
                        {t("settings.templateBuilder.required")}
                      </label>
                    </div>
                    
                    <input 
                      type="text" 
                      value={field.label}
                      onChange={(e) => updateField(field.id, { label: e.target.value })}
                      aria-label={t("settings.templateBuilder.fieldPlaceholder")}
                      placeholder={t("settings.templateBuilder.fieldPlaceholder")}
                      className="w-full border-2 border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-bold focus:border-blue-700 bg-white placeholder:text-gray-500 shadow-sm"
                    />

                    {(field.type === "SELECT" || field.type === "STATUS") && (
                      <div>
                        <label htmlFor={`${idPrefix}-${field.id}-options`} className="block text-xs font-bold text-gray-700 mb-1">{t("settings.templateBuilder.optionsLabel")}</label>
                        <input 
                          id={`${idPrefix}-${field.id}-options`}
                          type="text" 
                          value={field.options?.join(", ") || ""}
                          onChange={(e) => updateOptions(field.id, e.target.value)}
                          placeholder={field.type === "STATUS" ? t("settings.templateBuilder.optionsStatusPlaceholder") : t("settings.templateBuilder.optionsPlaceholder")}
                          className="w-full border border-gray-300 p-2.5 rounded-lg text-xs font-medium bg-white"
                        />
                      </div>
                    )}

                    {field.type === "STATUS" && (
                      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-3">
                        <label htmlFor={`${idPrefix}-${field.id}-comment-options`} className="block text-xs font-black text-amber-900 mb-1">
                          {t("settings.templateBuilder.commentOptionsLabel")}
                        </label>
                        <input
                          id={`${idPrefix}-${field.id}-comment-options`}
                          type="text"
                          aria-describedby={`${idPrefix}-${field.id}-comment-options-help`}
                          value={(field.commentOptions ?? []).join(", ")}
                          onChange={(e) =>
                            updateField(field.id, {
                              commentOptions: e.target.value
                                .split(",")
                                .map((o) => o.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder={t("settings.templateBuilder.commentOptionsPlaceholder")}
                          className="w-full border border-amber-300 p-2.5 rounded-lg text-xs font-medium bg-white"
                        />
                        <p id={`${idPrefix}-${field.id}-comment-options-help`} className="text-xs text-amber-800 mt-1">
                          {t("settings.templateBuilder.commentOptionsHelp")}
                        </p>
                      </div>
                    )}
                  </div>

                  <button 
                    type="button" 
                    onClick={() => removeField(field.id)} 
                    className="mt-1 text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 font-bold p-2.5 rounded-lg transition"
                    title={t("settings.templateBuilder.deleteField")}
                  >
                    {t("settings.templateBuilder.delete")}
                  </button>
                </div>

                {/* IFTTT (Conditional Logic) Inndeling */}
                <div className="bg-blue-50/60 p-3 rounded-xl border border-blue-200 flex flex-col md:flex-row gap-3 items-center text-xs">
                  <span className="font-black text-blue-900 whitespace-nowrap">{t("settings.templateBuilder.condition")}</span>
                  
                  <select 
                    aria-label={t("settings.templateBuilder.condition")}
                    value={field.conditionalFieldId || ""}
                    onChange={(e) => updateField(field.id, { conditionalFieldId: e.target.value || undefined })}
                    className="border border-blue-300 p-2 rounded-lg bg-white font-bold text-gray-800 flex-1"
                  >
                    <option value="">{t("settings.templateBuilder.alwaysVisible")}</option>
                    {fields.filter(f => f.id !== field.id).map(f => (
                      <option key={f.id} value={f.id}>
                        {t("settings.templateBuilder.showOnlyIf", {
                          label: f.label || t("settings.templateBuilder.unnamed"),
                        })}
                      </option>
                    ))}
                  </select>

                  {field.conditionalFieldId && (
                    <input 
                      type="text" 
                      aria-label={t("settings.templateBuilder.conditionPlaceholder")}
                      value={field.conditionalValue || ""}
                      onChange={(e) => updateField(field.id, { conditionalValue: e.target.value })}
                      placeholder={t("settings.templateBuilder.conditionPlaceholder")}
                      className="border border-blue-300 p-2 rounded-lg bg-white font-bold text-gray-800 w-48"
                    />
                  )}
                </div>

              </div>
            ))}
          </div>
        )}
      </div>

      {/* Velg felttype */}
      <div className="space-y-2 pt-2">
        <p className="text-xs font-black text-gray-500 uppercase tracking-wider">{t("settings.templateBuilder.addField")}</p>
        <div className="flex flex-wrap gap-2">
          {FIELD_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addField(type)}
              className={`bg-white text-gray-900 border-2 px-3.5 py-2.5 rounded-xl text-xs font-black hover:bg-gray-100 transition shadow-sm ${
                type === "STATUS" ? "border-blue-300 hover:bg-blue-50" : "border-gray-300"
              }`}
            >
              {t(`settings.templateBuilder.add.${type}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-6">
        <button type="submit" className="w-full bg-blue-700 text-white py-4 rounded-xl font-black hover:bg-blue-800 transition shadow-md text-lg tracking-wide">
          {t("settings.templateBuilder.save")}
        </button>
      </div>
    </form>
  );
}
