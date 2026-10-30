import { getTranslations } from "next-intl/server";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import type { SettingsOverviewData } from "@/server/settings";

type TagsTabProps = {
  tags: SettingsOverviewData["tags"];
  documentTags: SettingsOverviewData["documentTags"];
  isAdmin: boolean;
  createTag: (formData: FormData) => Promise<void>;
  updateTag: (formData: FormData) => Promise<void>;
  deleteTag: (formData: FormData) => Promise<void>;
  createDocumentTag: (formData: FormData) => Promise<void>;
  updateDocumentTag: (formData: FormData) => Promise<void>;
  deleteDocumentTag: (formData: FormData) => Promise<void>;
};

const FIELD = controlClassName("min-h-11 min-w-[150px] flex-1 text-sm font-medium");
const SIGNAL_BUTTON =
  "signal-button whitespace-nowrap text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]";
const INK_SMALL =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 text-xs font-bold text-[var(--ink,#101310)] transition hover:border-[var(--ink,#101310)]";
const DANGER_SMALL =
  "inline-flex min-h-9 items-center justify-center rounded-lg border border-[#e7b7a4] bg-[#fae8e0] px-3 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:bg-[#f6d9cf]";
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";

export default async function TagsTab({
  tags,
  documentTags,
  isAdmin,
  createTag,
  updateTag,
  deleteTag,
  createDocumentTag,
  updateDocumentTag,
  deleteDocumentTag,
}: TagsTabProps) {
  const t = await getTranslations("common");

  const tagRow = ({
    tag,
    idPrefix,
    updateAction,
    deleteAction,
    deleteKey,
  }: {
    tag: { id: string; name: string; color: string };
    idPrefix: string;
    updateAction: (formData: FormData) => Promise<void>;
    deleteAction: (formData: FormData) => Promise<void>;
    deleteKey: "deleteTag" | "deleteDocumentTag";
  }) => (
    <div
      key={tag.id}
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <span
          className="inline-block h-6 w-6 rounded-full border border-[var(--line,#dedcd1)]"
          style={{ backgroundColor: tag.color }}
          suppressHydrationWarning
        />
        <span className="break-words font-bold text-[var(--ink,#101310)]">{tag.name}</span>
        <span className="font-mono text-xs text-[var(--muted,#62685f)]">{tag.color}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <details className="relative">
          <summary className={`${INK_SMALL} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
            {t("settings.tags.edit")}
          </summary>
          <div className="absolute right-0 top-full z-10 mt-2 w-72 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4 shadow-lg">
            <form action={updateAction} className="space-y-3">
              <input type="hidden" name="id" value={tag.id} />
              <div>
                <label htmlFor={`${idPrefix}-${tag.id}-name`} className={LABEL}>
                  {t("settings.tags.name")}
                </label>
                <input
                  id={`${idPrefix}-${tag.id}-name`}
                  type="text"
                  name="name"
                  defaultValue={tag.name}
                  required
                  className={controlClassName("min-h-10 text-sm font-medium")}
                />
              </div>
              <div>
                <label htmlFor={`${idPrefix}-${tag.id}-color`} className={LABEL}>
                  {t("settings.tags.color")}
                </label>
                <input
                  id={`${idPrefix}-${tag.id}-color`}
                  type="color"
                  name="color"
                  defaultValue={tag.color}
                  className="h-10 w-10 cursor-pointer rounded-lg border border-[var(--line,#dedcd1)] p-1"
                />
              </div>
              <button type="submit" className={`${INK_SMALL} w-full`}>
                {t("settings.tags.save")}
              </button>
            </form>
          </div>
        </details>
        {isAdmin && (
          <ConfirmSubmitForm
            action={deleteAction}
            confirmMessage={
              deleteKey === "deleteTag"
                ? t("components.confirm.deleteTag", { name: tag.name })
                : t("components.confirm.deleteDocumentTag", { name: tag.name })
            }
            confirmLabel={
              deleteKey === "deleteTag"
                ? t("components.confirm.deleteTagLabel")
                : t("components.confirm.deleteDocumentTagLabel")
            }
            danger
          >
            <input type="hidden" name="id" value={tag.id} />
            <button type="submit" className={DANGER_SMALL}>
              {t("settings.tags.delete")}
            </button>
          </ConfirmSubmitForm>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* OPPDRAG-TAGS */}
      <section className="office-card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
          <Icon name="flag" className="h-4 w-4 shrink-0 text-[var(--ink,#101310)]" />
          <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
            {t("settings.tags.workOrdersTitle")}
          </h2>
        </div>
        <p className="mb-4 text-sm text-[var(--muted,#62685f)]">
          {t("settings.tags.workOrdersDesc")}
        </p>

        <form action={createTag} className="mb-5 flex max-w-lg flex-wrap gap-3">
          <input
            type="text"
            name="name"
            aria-label={t("settings.tags.name")}
            placeholder={t("settings.tags.namePlaceholder")}
            required
            className={FIELD}
          />
          <input
            type="color"
            name="color"
            aria-label={t("settings.tags.color")}
            defaultValue="#3b82f6"
            className="h-11 w-11 cursor-pointer rounded-lg border border-[var(--line,#dedcd1)] p-1"
          />
          <button type="submit" className={SIGNAL_BUTTON}>
            {t("settings.tags.createButton")}
          </button>
        </form>

        {tags.length === 0 ? (
          <p className="text-sm italic text-[var(--muted,#62685f)]">{t("settings.tags.emptyWorkOrders")}</p>
        ) : (
          <div className="space-y-2">
            {tags.map((tag) =>
              tagRow({
                tag,
                idPrefix: "tag",
                updateAction: updateTag,
                deleteAction: deleteTag,
                deleteKey: "deleteTag",
              }),
            )}
          </div>
        )}
      </section>

      {/* DOKUMENT-TAGS */}
      <section className="office-card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2 border-b border-[var(--line,#dedcd1)] pb-3">
          <Icon name="file" className="h-4 w-4 shrink-0 text-[var(--ink,#101310)]" />
          <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
            {t("settings.tags.documentsTitle")}
          </h2>
        </div>
        <p className="mb-4 text-sm text-[var(--muted,#62685f)]">
          {t("settings.tags.documentsDesc")}
        </p>

        <form action={createDocumentTag} className="mb-5 flex max-w-lg flex-wrap gap-3">
          <input
            type="text"
            name="name"
            aria-label={t("settings.tags.name")}
            placeholder={t("settings.tags.namePlaceholder")}
            required
            className={FIELD}
          />
          <input
            type="color"
            name="color"
            aria-label={t("settings.tags.color")}
            defaultValue="#10b981"
            className="h-11 w-11 cursor-pointer rounded-lg border border-[var(--line,#dedcd1)] p-1"
          />
          <button type="submit" className={SIGNAL_BUTTON}>
            {t("settings.tags.createButton")}
          </button>
        </form>

        {documentTags.length === 0 ? (
          <p className="text-sm italic text-[var(--muted,#62685f)]">{t("settings.tags.emptyDocuments")}</p>
        ) : (
          <div className="space-y-2">
            {documentTags.map((tag) =>
              tagRow({
                tag,
                idPrefix: "doctag",
                updateAction: updateDocumentTag,
                deleteAction: deleteDocumentTag,
                deleteKey: "deleteDocumentTag",
              }),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
