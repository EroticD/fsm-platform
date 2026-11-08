import { getTranslations } from "next-intl/server";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import { EQUIPMENT_ERROR_KEYS } from "@/lib/equipment-feedback";
import type { EquipmentCategoryNode } from "@/server/equipment";

type CategoryAction = (formData: FormData) => void | Promise<void>;

type EquipmentCategoriesTabProps = {
  tree: EquipmentCategoryNode[];
  flat: Array<{ id: string; name: string; parentId: string | null }>;
  canManage: boolean;
  error?: string;
  ok?: string;
  createCategory: CategoryAction;
  updateCategory: CategoryAction;
  deleteCategory: CategoryAction;
};

const FIELD = controlClassName("min-h-11 text-sm font-medium");
const SMALL_BUTTON =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]";
const DANGER_BUTTON =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-[#e7b7a4] bg-[var(--risk-surface,#fdf4f2)] px-3 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#f6d9cf] disabled:cursor-not-allowed disabled:opacity-50";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";

function descendants(node: EquipmentCategoryNode): Set<string> {
  const ids = new Set<string>();
  const walk = (current: EquipmentCategoryNode) => {
    for (const child of current.children) {
      ids.add(child.id);
      walk(child);
    }
  };
  walk(node);
  return ids;
}

export default async function EquipmentCategoriesTab({
  tree,
  flat,
  canManage,
  error,
  ok,
  createCategory,
  updateCategory,
  deleteCategory,
}: EquipmentCategoriesTabProps) {
  const t = await getTranslations("common");
  const errorKey =
    error && EQUIPMENT_ERROR_KEYS.has(error)
      ? error
      : error
        ? "assets.errors.generic"
        : null;
  const successKey =
    ok === "category-created"
      ? "settings.equipmentCategories.created"
      : ok === "category-updated"
        ? "settings.equipmentCategories.updated"
        : ok === "category-deleted"
          ? "settings.equipmentCategories.deleted"
          : null;

  const parentOptions = (excluded: Set<string> = new Set()) =>
    flat
      .filter((category) => !excluded.has(category.id))
      .map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ));

  const renderNode = (node: EquipmentCategoryNode, depth: number) => {
    const blocked = node.productCount > 0 || node.children.length > 0;
    const excluded = descendants(node);
    excluded.add(node.id);
    return (
      <li key={node.id} className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 break-words font-bold text-[var(--ink,#101310)]">
              <Icon
                name={node.children.length > 0 ? "folder" : "wrench"}
                className="h-4 w-4 shrink-0 text-[var(--muted,#62685f)]"
              />
              {node.name}
            </p>
            <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
              {t("settings.equipmentCategories.products", {
                count: node.productCount,
              })}
              {node.children.length > 0
                ? ` • ${t("settings.equipmentCategories.children", {
                    count: node.children.length,
                  })}`
                : ""}
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <details className="relative">
                <summary
                  className={`${SMALL_BUTTON} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
                >
                  {t("settings.equipmentCategories.edit")}
                </summary>
                <div className="absolute right-0 top-full z-20 mt-2 w-[min(22rem,80vw)] rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4 shadow-lg">
                  <form action={updateCategory} className="space-y-3">
                    <input type="hidden" name="id" value={node.id} />
                    <div>
                      <label
                        htmlFor={`category-${node.id}-name`}
                        className={LABEL}
                      >
                        {t("settings.equipmentCategories.name")}
                      </label>
                      <input
                        id={`category-${node.id}-name`}
                        name="name"
                        type="text"
                        required
                        maxLength={120}
                        defaultValue={node.name}
                        className={FIELD}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`category-${node.id}-parent`}
                        className={LABEL}
                      >
                        {t("settings.equipmentCategories.parent")}
                      </label>
                      <select
                        id={`category-${node.id}-parent`}
                        name="parentId"
                        defaultValue={node.parentId ?? ""}
                        className={FIELD}
                      >
                        <option value="">
                          {t("settings.equipmentCategories.noParent")}
                        </option>
                        {parentOptions(excluded)}
                      </select>
                    </div>
                    <button type="submit" className={`${SMALL_BUTTON} w-full`}>
                      {t("settings.equipmentCategories.save")}
                    </button>
                  </form>
                </div>
              </details>
              {blocked ? (
                <span
                  className={`${DANGER_BUTTON} cursor-not-allowed`}
                  title={t("settings.equipmentCategories.inUse")}
                >
                  {t("settings.equipmentCategories.delete")}
                </span>
              ) : (
                <ConfirmSubmitForm
                  action={deleteCategory}
                  confirmMessage={t(
                    "settings.equipmentCategories.deleteConfirm",
                    { name: node.name },
                  )}
                  confirmLabel={t("settings.equipmentCategories.delete")}
                  danger
                >
                  <input type="hidden" name="id" value={node.id} />
                  <button type="submit" className={DANGER_BUTTON}>
                    {t("settings.equipmentCategories.delete")}
                  </button>
                </ConfirmSubmitForm>
              )}
            </div>
          )}
        </div>
        {node.children.length > 0 && (
          <ul className="ml-4 space-y-2 border-l border-[var(--line,#dedcd1)] pl-3">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <section className="space-y-5">
      <div className="office-card p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
          <Icon name="wrench" className="h-4 w-4" />
          {t("settings.equipmentCategories.title")}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
          {t("settings.equipmentCategories.description")}
        </p>
        {!canManage && (
          <p className="mt-3 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-bold text-[var(--muted,#62685f)]">
            {t("settings.equipmentCategories.readOnly")}
          </p>
        )}
        {successKey && (
          <p
            role="status"
            className="mt-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-bold text-green-900"
          >
            {t(successKey)}
          </p>
        )}
        {errorKey && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-900"
          >
            {t(errorKey as Parameters<typeof t>[0])}
          </p>
        )}
      </div>

      {canManage && (
        <div className="office-card p-4 sm:p-5">
          <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
            {t("settings.equipmentCategories.createTitle")}
          </h3>
          <form
            action={createCategory}
            className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          >
            <div>
              <label htmlFor="new-category-name" className={LABEL}>
                {t("settings.equipmentCategories.name")}
              </label>
              <input
                id="new-category-name"
                name="name"
                type="text"
                required
                maxLength={120}
                className={FIELD}
                placeholder={t("settings.equipmentCategories.namePlaceholder")}
              />
            </div>
            <div>
              <label htmlFor="new-category-parent" className={LABEL}>
                {t("settings.equipmentCategories.parent")}
              </label>
              <select
                id="new-category-parent"
                name="parentId"
                className={FIELD}
                defaultValue=""
              >
                <option value="">
                  {t("settings.equipmentCategories.noParent")}
                </option>
                {parentOptions()}
              </select>
            </div>
            <button type="submit" className="signal-button min-h-11 px-4 text-sm">
              {t("settings.equipmentCategories.create")}
            </button>
          </form>
        </div>
      )}

      <div className="office-card p-4 sm:p-5">
        {tree.length === 0 ? (
          <p className="text-sm text-[var(--muted,#62685f)]">
            {t("settings.equipmentCategories.empty")}
          </p>
        ) : (
          <ul className="space-y-2">{tree.map((node) => renderNode(node, 0))}</ul>
        )}
      </div>
    </section>
  );
}
