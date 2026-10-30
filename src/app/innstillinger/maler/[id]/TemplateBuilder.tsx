"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
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

const FIELD = controlClassName("min-h-11 text-sm font-bold");
const SMALL_FIELD = controlClassName("min-h-10 text-xs font-medium");
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";
const INK_SMALL =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-[10px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-1 text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)] disabled:cursor-not-allowed disabled:opacity-30";

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
    <form action={saveAction} className="office-card space-y-8 p-5 sm:p-6">
      
      <input type="hidden" name="fieldsJson" value={JSON.stringify(fields)} />
      <input type="hidden" name="id" value={templateId} />
      <input type="hidden" name="requiresUnits" value={requiresUnits ? "true" : "false"} />
      
      <div>
        <label htmlFor="template-builder-name" className={LABEL}>{t("settings.templateBuilder.name")}</label>
        <input 
          id="template-builder-name"
          type="text" 
          name="title" 
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required 
          className={controlClassName("min-h-11 text-base font-bold")}
        />
      </div>

      <div>
        <label htmlFor="template-builder-description" className={LABEL}>
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
          className={controlClassName("text-sm font-medium")}
        />
        <p id="template-builder-description-hint" className="mt-1 text-xs text-[var(--muted,#62685f)]">
          {t("settings.templateBuilder.descriptionHint")}
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="template-builder-category" className={LABEL}>
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
            className={FIELD}
          >
            <option value="SERVICE">{t("settings.templates.categories.SERVICE")}</option>
            <option value="HMS">{t("settings.templates.categories.HMS")}</option>
          </select>
        </div>

        {category === "HMS" && (
          <div>
            <label htmlFor="template-builder-hms-type" className={LABEL}>
              {t("settings.templateBuilder.hmsType")}
            </label>
            <select
              id="template-builder-hms-type"
              name="hmsType"
              aria-describedby="template-builder-hms-type-hint"
              value={hmsType}
              onChange={(e) => setHmsType(e.target.value)}
              required
              className={FIELD}
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
            <p id="template-builder-hms-type-hint" className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("settings.templateBuilder.hmsTypeHint")}
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="template-builder-report-name" className={LABEL}>
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
            className={FIELD}
          />
          <p id="template-builder-report-name-hint" className="mt-1 text-xs text-[var(--muted,#62685f)]">{t("settings.templateBuilder.reportNameHint")}</p>
        </div>

        <div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-[var(--ink,#101310)]">
            <input
              type="checkbox"
              checked={requiresUnits}
              onChange={(e) => setRequiresUnits(e.target.checked)}
              aria-describedby="template-builder-requires-units-hint"
              className="h-4 w-4 cursor-pointer rounded accent-[var(--ink,#101310)]"
            />
            {t("settings.templateBuilder.requiresUnits")}
          </label>
          <p id="template-builder-requires-units-hint" className="mt-1 text-xs text-[var(--muted,#62685f)]">{t("settings.templateBuilder.requiresUnitsHint")}</p>
        </div>
      </div>

      <div className="border-t border-[var(--line,#dedcd1)] pt-6">
        <h2 className="mb-4 text-base font-extrabold text-[var(--ink,#101310)]">{t("settings.templateBuilder.sectionTitle")}</h2>
        
        {fields.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-8 text-center">
            <p className="mb-1 font-bold text-[var(--ink,#101310)]">{t("settings.templateBuilder.emptyTitle")}</p>
            <p className="text-sm font-medium text-[var(--muted,#62685f)]">{t("settings.templateBuilder.emptyDesc")}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {fields.map((field, index) => (
              <div key={field.id} className="group space-y-4 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-4 sm:p-5">
                
                <div className="flex gap-4 items-start">
                  {/* Pil opp/ned */}
                  <div className="flex flex-col gap-1 mt-1">
                    <button 
                      type="button" 
                      onClick={() => moveField(index, "UP")} 
                      disabled={index === 0} 
                      aria-label={t("settings.templateBuilder.moveUp")}
                      className={INK_SMALL}
                      title={t("settings.templateBuilder.moveUp")}
                    >
                      <Icon name="chevronDown" className="h-4 w-4 rotate-180" />
                    </button>
                    <button 
                      type="button" 
                      onClick={() => moveField(index, "DOWN")} 
                      disabled={index === fields.length - 1} 
                      aria-label={t("settings.templateBuilder.moveDown")}
                      className={INK_SMALL}
                      title={t("settings.templateBuilder.moveDown")}
                    >
                      <Icon name="chevronDown" className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex-1 space-y-3">
                    <div className="flex justify-between items-center flex-wrap gap-2">
                      <span className="inline-flex items-center rounded-md border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1 text-xs font-bold uppercase tracking-[0.08em] text-[var(--ink,#101310)]">
                        {t(`settings.templateBuilder.types.${field.type}`)}
                      </span>
                      
                      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--surface,#fffdf8)]">
                        <input 
                          type="checkbox" 
                          checked={field.required} 
                          onChange={(e) => updateField(field.id, { required: e.target.checked })} 
                          className="h-4 w-4 cursor-pointer rounded accent-[var(--ink,#101310)]"
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
                      className={FIELD}
                    />

                    {(field.type === "SELECT" || field.type === "STATUS") && (
                      <div>
                        <label htmlFor={`${idPrefix}-${field.id}-options`} className={LABEL}>{t("settings.templateBuilder.optionsLabel")}</label>
                        <input 
                          id={`${idPrefix}-${field.id}-options`}
                          type="text" 
                          value={field.options?.join(", ") || ""}
                          onChange={(e) => updateOptions(field.id, e.target.value)}
                          placeholder={field.type === "STATUS" ? t("settings.templateBuilder.optionsStatusPlaceholder") : t("settings.templateBuilder.optionsPlaceholder")}
                          className={SMALL_FIELD}
                        />
                      </div>
                    )}

                    {field.type === "STATUS" && (
                      <div className="rounded-xl border border-[#e2cf9b] bg-[#fbf1d2] p-3">
                        <label htmlFor={`${idPrefix}-${field.id}-comment-options`} className={LABEL}>
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
                          className={SMALL_FIELD}
                        />
                        <p id={`${idPrefix}-${field.id}-comment-options-help`} className="mt-1 text-xs text-[#6b4a05]">
                          {t("settings.templateBuilder.commentOptionsHelp")}
                        </p>
                      </div>
                    )}
                  </div>

                  <button 
                    type="button" 
                    onClick={() => removeField(field.id)} 
                    className="mt-1 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[#e7b7a4] bg-[#fae8e0] p-2.5 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#f6d9cf]"
                    title={t("settings.templateBuilder.deleteField")}
                  >
                    <Icon name="trash" className="h-4 w-4" />
                    {t("settings.templateBuilder.delete")}
                  </button>
                </div>

                {/* IFTTT (Conditional Logic) Inndeling */}
                <div className="flex flex-col items-center gap-3 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3 text-xs md:flex-row">
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-bold text-[var(--ink,#101310)]">
                    <Icon name="route" className="h-3.5 w-3.5" />
                    {t("settings.templateBuilder.condition")}
                  </span>
                  
                  <select 
                    aria-label={t("settings.templateBuilder.condition")}
                    value={field.conditionalFieldId || ""}
                    onChange={(e) => updateField(field.id, { conditionalFieldId: e.target.value || undefined })}
                    className={`${SMALL_FIELD} flex-1`}
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
                      className={`${SMALL_FIELD} w-full md:w-48`}
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
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">{t("settings.templateBuilder.addField")}</p>
        <div className="flex flex-wrap gap-2">
          {FIELD_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addField(type)}
              className={`inline-flex min-h-11 items-center rounded-[10px] border px-3.5 py-2 text-xs font-bold text-[var(--ink,#101310)] transition ${
                type === "STATUS"
                  ? "border-[#c7d98e] bg-[#f3fbd1] hover:bg-[var(--signal,#d8ff3e)]"
                  : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
              }`}
            >
              {t(`settings.templateBuilder.add.${type}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[var(--line,#dedcd1)] pt-6">
        <button type="submit" className="signal-button w-full text-sm shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]">
          {t("settings.templateBuilder.save")}
        </button>
      </div>
    </form>
  );
}
