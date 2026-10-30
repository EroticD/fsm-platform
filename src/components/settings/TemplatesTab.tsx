import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { SettingsOverviewData } from "@/server/settings";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Icon from "@/components/icons";
import TemplateCreateForm from "@/components/settings/TemplateCreateForm";
import { HMS_FORM_GROUPS } from "@/lib/hms";

type TemplateCategoryFilter = "SERVICE" | "HMS" | null;

type TemplatesTabProps = {
  templates: SettingsOverviewData["templates"];
  isAdmin: boolean;
  categoryFilter?: TemplateCategoryFilter;
  createTemplate: (formData: FormData) => Promise<void>;
  deleteTemplate: (formData: FormData) => Promise<void>;
};

function filterHref(category: TemplateCategoryFilter): string {
  return `/innstillinger?tab=maler${category ? `&category=${category}` : ""}`;
}

const filterClass = (active: boolean) =>
  `inline-flex min-h-9 items-center rounded-full border px-3 py-1 text-xs font-bold transition ${
    active
      ? "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
      : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]"
  }`;

const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-xs font-bold text-[var(--ink,#101310)]";
const INK_SMALL =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]";
const DANGER_SMALL =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-[#e7b7a4] bg-[#fae8e0] px-3 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#f6d9cf]";

export default async function TemplatesTab({
  templates,
  isAdmin,
  categoryFilter = null,
  createTemplate,
  deleteTemplate,
}: TemplatesTabProps) {
  const t = await getTranslations("common");

  const hmsTypes = HMS_FORM_GROUPS.map((group) => ({
    value: group.type,
    label: t(`settings.templates.hmsTypes.${group.type}`),
  }));
  const hmsTypeLabels = new Map(
    hmsTypes.map((option) => [option.value, option.label]),
  );

  const visibleTemplates = categoryFilter
    ? templates.filter((template) => template.category === categoryFilter)
    : templates;
  const serviceCount = templates.filter(
    (template) => template.category === "SERVICE",
  ).length;
  const hmsCount = templates.filter(
    (template) => template.category === "HMS",
  ).length;

  return (
    <div className="space-y-5">
      {/* Opprett ny mal */}
      <section className="office-card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
          <Icon name="plus" className="h-4 w-4 shrink-0 text-[var(--ink,#101310)]" />
          <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
            {t("settings.templates.createTitle")}
          </h2>
        </div>
        <p className="mb-4 text-sm text-[var(--muted,#62685f)]">
          {t("settings.templates.createDesc")}
        </p>

        <TemplateCreateForm createTemplate={createTemplate} hmsTypes={hmsTypes} />
      </section>

      {/* Eksisterende maler */}
      <section className="office-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line,#dedcd1)] pb-3">
          <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
            {t("settings.templates.available", { count: visibleTemplates.length })}
          </h2>
          <Link
            href="/innstillinger?tab=maler&category=HMS"
            className="inline-flex min-h-9 items-center gap-1.5 text-xs font-bold text-[var(--ink,#101310)] underline-offset-2 hover:underline"
          >
            <Icon name="shield" className="h-4 w-4 shrink-0" />
            {t("settings.templates.hmsTemplatesLink")}
          </Link>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
            {t("settings.templates.filterLabel")}
          </span>
          <Link href={filterHref(null)} className={filterClass(categoryFilter === null)}>
            {t("settings.templates.filterAll")} ({templates.length})
          </Link>
          <Link
            href={filterHref("SERVICE")}
            className={filterClass(categoryFilter === "SERVICE")}
          >
            {t("settings.templates.categories.SERVICE")} ({serviceCount})
          </Link>
          <Link
            href={filterHref("HMS")}
            className={filterClass(categoryFilter === "HMS")}
          >
            {t("settings.templates.categories.HMS")} ({hmsCount})
          </Link>
        </div>

        {visibleTemplates.length === 0 ? (
          <p className="text-sm italic text-[var(--muted,#62685f)]">{t("settings.templates.empty")}</p>
        ) : (
          <div className="space-y-2">
            {visibleTemplates.map((template) => {
              const usage =
                template._count.reports +
                template._count.workOrder +
                template._count.contracts;
              const deleteMessage =
                usage > 0
                  ? t("settings.templates.deleteUsageWarning", {
                      title: template.title,
                      reports: template._count.reports,
                      workOrders: template._count.workOrder,
                      contracts: template._count.contracts,
                    })
                  : t("settings.templates.deleteConfirm", {
                      title: template.title,
                    });
              const hmsLabel =
                template.category === "HMS" && template.hmsType
                  ? hmsTypeLabels.get(template.hmsType) ?? template.hmsType
                  : null;
              return (
              <div
                key={template.id}
                className="flex flex-col gap-3 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <span className="break-words font-bold text-[var(--ink,#101310)]">{template.title}</span>
                  {template.description && (
                    <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
                      {template.description}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {template.category === "HMS" ? (
                      <span className={CHIP}>
                        <Icon name="shield" className="h-3 w-3 shrink-0" />
                        HMS{hmsLabel ? ` · ${hmsLabel}` : ""}
                      </span>
                    ) : (
                      <span className={CHIP}>
                        {t("settings.templates.categories.SERVICE")}
                      </span>
                    )}
                    <span className={CHIP}>
                      {t("settings.templateBuilder.reportName")}: {template.reportName || template.title}
                    </span>
                    <span className={CHIP}>
                      <Icon
                        name={template.requiresUnits ? "check" : "close"}
                        className="h-3 w-3 shrink-0"
                      />
                      {t("settings.templateBuilder.requiresUnits")}
                    </span>
                    {usage > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#e2cf9b] bg-[#fbf1d2] px-2 py-0.5 text-xs font-bold text-[#6b4a05]">
                        <Icon name="alert" className="h-3 w-3 shrink-0" />
                        {t("settings.templates.inUse", { count: usage })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    href={`/innstillinger/maler/${template.id}`}
                    className={INK_SMALL}
                  >
                    {t("settings.templates.edit")}
                  </Link>

                  {isAdmin && (
                    <ConfirmSubmitForm
                      action={deleteTemplate}
                      confirmMessage={deleteMessage}
                      confirmLabel={t("delete")}
                      danger
                    >
                      <input type="hidden" name="id" value={template.id} />
                      <button type="submit" className={DANGER_SMALL}>
                        {t("settings.templates.delete")}
                      </button>
                    </ConfirmSubmitForm>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
