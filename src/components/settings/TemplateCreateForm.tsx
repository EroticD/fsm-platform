"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { TEMPLATE_CATEGORIES } from "@/lib/template-category";

export type HmsTypeOption = {
  value: string;
  label: string;
};

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
        placeholder={t("settings.templates.titlePlaceholder")}
        required
        className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500"
      />
      <input
        type="text"
        name="reportName"
        placeholder={t("settings.templates.reportNamePlaceholder")}
        className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500"
      />
      <textarea
        name="description"
        rows={2}
        placeholder={t("settings.templates.descriptionPlaceholder")}
        className="w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-bold text-gray-900">
          {t("settings.templates.category")}
          <select
            name="category"
            value={category}
            onChange={(event) =>
              setCategory(
                event.target.value as (typeof TEMPLATE_CATEGORIES)[number],
              )
            }
            className="mt-1 w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500 bg-white"
          >
            {TEMPLATE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`settings.templates.categories.${value}`)}
              </option>
            ))}
          </select>
        </label>

        {category === "HMS" && (
          <label className="block text-sm font-bold text-gray-900">
            {t("settings.templates.hmsType")}
            <select
              name="hmsType"
              required
              defaultValue=""
              className="mt-1 w-full border border-gray-300 p-3 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500 bg-white"
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
      <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
        <input type="hidden" name="requiresUnits" value="false" />
        <input
          type="checkbox"
          name="requiresUnits"
          value="true"
          defaultChecked
          className="w-4 h-4 rounded border-gray-400 text-blue-700 focus:ring-blue-600"
        />
        {t("settings.templates.createRequiresUnits")}
      </label>
      <button
        type="submit"
        className="w-full bg-[var(--primary-color)] text-white px-5 py-3 rounded-xl font-bold hover:opacity-90 transition shadow-sm"
      >
        {t("settings.templates.createButton")}
      </button>
    </form>
  );
}
