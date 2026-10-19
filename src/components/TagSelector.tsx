"use client";

import { useState } from "react";

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
        <div className="flex flex-wrap gap-2 w-full min-w-0">
          {allTags.map((tag) => {
            const isSelected = selected.has(tag.name);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(tag.name)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border-2 transition shadow-sm ${
                  isSelected
                    ? "text-white border-transparent"
                    : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
                }`}
                style={isSelected ? { backgroundColor: tag.color, borderColor: tag.color } : {}}
              >
                🏷️ {tag.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Add new tag input */}
      <div className="flex gap-2 flex-wrap w-full">
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
          placeholder="Ny tag (Enter for å legge til)"
          className="flex-1 border border-gray-300 p-2 rounded-xl text-sm text-gray-900 font-medium outline-none focus:border-blue-500"
        />
        <button
          type="button"
          onClick={addNew}
          className="bg-gray-200 text-gray-700 px-3 py-2 rounded-xl text-sm font-bold hover:bg-gray-300 transition"
        >
          + Legg til
        </button>
      </div>

      {/* Selected tags preview */}
      {selectedArray.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-gray-100 w-full">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider w-full">Valgte tags:</span>
          {selectedArray.map((tagName) => {
            const tag = allTags.find((t) => t.name === tagName);
            const color = tag?.color || "#6b7280";
            return (
              <span
                key={tagName}
                className="text-white px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                style={{ backgroundColor: color }}
              >
                🏷️ {tagName}
                <button
                  type="button"
                  onClick={() => toggle(tagName)}
                  className="ml-1 hover:opacity-70"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}