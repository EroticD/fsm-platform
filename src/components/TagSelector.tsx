"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import { readableTextColor } from "@/lib/colors";

/** Stabil tom liste, så standardverdien ikke gir ny referanse ved hver render. */
const EMPTY_TAGS: string[] = [];

type Tag = {
  id: string;
  name: string;
  color: string;
};

export default function TagSelector({
  allTags,
  selectedTagNames = EMPTY_TAGS,
  name = "tags",
}: {
  allTags: Tag[];
  selectedTagNames?: string[];
  name?: string;
}) {
  const t = useTranslations("common");
  // Utvalget initialiseres fra prop-en. Komponenten remountes når man bytter
  // dokument/oppdrag, så det er ikke behov for å synkronisere i en effect.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedTagNames));
  const [newTagName, setNewTagName] = useState("");

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addNew() {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.add(trimmed);
      return next;
    });
    setNewTagName("");
  }

  // Combine allTags (with colors) + any newly added tags (without color yet)
  const selectedArray = Array.from(selected);

  return (
    <div className="space-y-3">
      {/* Hidden inputs for form submission */}
      {selectedArray.map((tagName) => (
        <input key={tagName} type="hidden" name={name} value={tagName} />
      ))}

      {/* Existing tags as selectable chips */}
      {allTags.length > 0 && (
        <div className="flex w-full min-w-0 flex-wrap gap-2">
          {allTags.map((tag) => {
            const isSelected = selected.has(tag.name);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(tag.name)}
                aria-pressed={isSelected}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                  isSelected
                    ? "border-transparent shadow-sm"
                    : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)] hover:border-[var(--ink,#101310)]"
                }`}
                style={
                  isSelected
                    ? {
                        backgroundColor: tag.color,
                        borderColor: tag.color,
                        color: readableTextColor(tag.color),
                      }
                    : {}
                }
              >
                <Icon
                  name={isSelected ? "check" : "flag"}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span>{tag.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Add new tag input */}
      <div className="flex w-full flex-wrap gap-2">
        <input
          type="text"
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addNew();
            }
          }}
          aria-label={t("documents.tagSelector.newTagPlaceholder")}
          placeholder={t("documents.tagSelector.newTagPlaceholder")}
          className={`${controlClassName("min-h-11")} min-w-0 flex-1`}
        />
        <button
          type="button"
          onClick={addNew}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]"
        >
          {t("documents.tagSelector.add")}
        </button>
      </div>

      {/* Selected tags preview */}
      {selectedArray.length > 0 && (
        <div className="w-full space-y-1.5 border-t border-[var(--line,#dedcd1)] pt-2">
          <span className="block text-2xs font-bold uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
            {t("documents.tagSelector.selected")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {selectedArray.map((tagName) => {
              const tag = allTags.find((t) => t.name === tagName);
              const color = tag?.color || "#6b7280";
              return (
                <span
                  key={tagName}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold"
                  suppressHydrationWarning
                  style={{ backgroundColor: color, color: readableTextColor(color) }}
                >
                  <Icon name="flag" className="h-3 w-3 shrink-0" />
                  <span>{tagName}</span>
                  <button
                    type="button"
                    onClick={() => toggle(tagName)}
                    aria-label={t("components.tagSelector.remove", { name: tagName })}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-black/10"
                  >
                    <Icon name="close" className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
