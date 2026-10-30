"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { controlClassName } from "@/components/ui/controlStyles";
import { TEMPLATE_CATEGORIES } from "@/lib/template-category";

export type HmsTypeOption = {
  value: string;
  label: string;
};

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";
const SIGNAL_BUTTON =
  "signal-button w-full text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";

export default function TemplateCreateForm({
  createTemplate,
  hmsTypes,
}: {
  createTemplate: (formData: FormData) => Promise<void>;
  hmsTypes: HmsTypeOption[];
}) {
  const t = useTranslations("common");
  const [category, setCategory] = useState<(typeof TEMPLATE_CATEGORIES)[number]>(
    "SERVICE",
  );

  return (
    <form action={createTemplate} className="max-w-lg space-y-3">
      <input
        type="text"
        name="title"
        aria-label={t("settings.templates.titlePlaceholder")}
        placeholder={t("settings.templates.titlePlaceholder")}
        required
        className={FIELD}
      />
      <input
        type="text"
        name="reportName"
        aria-label={t("settings.templates.reportNamePlaceholder")}
        placeholder={t("settings.templates.reportNamePlaceholder")}
        className={FIELD}
      />
      <textarea
        name="description"
        rows={2}
        aria-label={t("settings.templates.descriptionPlaceholder")}
        placeholder={t("settings.templates.descriptionPlaceholder")}
        className={controlClassName("text-sm font-medium")}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>{t("settings.templates.category")}</span>
          <select
            name="category"
            value={category}
            onChange={(event) =>
              setCategory(
                event.target.value as (typeof TEMPLATE_CATEGORIES)[number],
              )
            }
            className={FIELD}
          >
            {TEMPLATE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`settings.templates.categories.${value}`)}
              </option>
            ))}
          </select>
        </label>

        {category === "HMS" && (
          <label className="block">
            <span className={LABEL}>{t("settings.templates.hmsType")}</span>
            <select
              name="hmsType"
              required
              defaultValue=""
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
          </label>
        )}
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--ink,#101310)]">
        <input type="hidden" name="requiresUnits" value="false" />
        <input
          type="checkbox"
          name="requiresUnits"
          value="true"
          defaultChecked
          className="h-4 w-4 rounded accent-[var(--ink,#101310)]"
        />
        {t("settings.templates.createRequiresUnits")}
      </label>
      <button type="submit" className={SIGNAL_BUTTON}>
        {t("settings.templates.createButton")}
      </button>
    </form>
  );
}
