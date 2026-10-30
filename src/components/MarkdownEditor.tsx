"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import MarkdownView from "@/components/MarkdownView";
import Icon, { type IconName } from "@/components/icons";

/**
 * Tekstfelt med Markdown og en enkel formateringslinje.
 *
 * Feltet er et vanlig `<textarea>` med `name`, slik at det kan brukes i skjema
 * som sender til en server action på samme måte som før. Formateringen settes
 * inn der markøren står, og det som skrives kan forhåndsvises med én knapp.
 *
 * Syntaksen følger Obsidian (https://obsidian.md/help/syntax) – se
 * lib/markdown-obsidian.ts for hva som støttes.
 */

type ToolbarButton = {
  /** Kort tekst på knappen. */
  label?: string;
  /** Monokromt ikon i stedet for tekst, der et ikon er tydeligere. */
  icon?: IconName;
  /** Forklaring som vises når musen hviler over knappen. */
  title: string;
  run: (editor: EditorApi) => void;
};

type EditorApi = {
  /** Setter inn tekst der markøren står (bevarer angre-historikken). */
  insert: (text: string) => void;
  /** Legger noe før og etter det som er markert. */
  wrap: (before: string, after: string, placeholder?: string) => void;
  /** Setter inn foran (eller fjerner fra) hver linje i utvalget. */
  lines: (prefix: string, options?: { ordered?: boolean }) => void;
  /** Markerer et tekstområde i feltet. */
  select: (start: number, length: number) => void;
  /** Leser ut og skriver til feltet. */
  read: () => { value: string; start: number; end: number };
};

export default function MarkdownEditor({
  name,
  defaultValue = "",
  id,
  rows = 6,
  placeholder,
  className = "",
  required = false,
  autoFocus = false,
  disabled = false,
  onChange,
}: {
  name: string;
  defaultValue?: string | null;
  id?: string;
  rows?: number;
  placeholder?: string;
  className?: string;
  required?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Varsler skjemaet om teksten, for skjemaer som vil følge med underveis. */
  onChange?: (value: string) => void;
}) {
  const t = useTranslations("common");
  const [value, setValue] = useState(defaultValue ?? "");
  const [preview, setPreview] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const wantedSelection = useRef<{ start: number; length: number } | null>(null);

  const buttons: ToolbarButton[] = [
    {
      label: "B",
      title: t("components.markdown.bold"),
      run: (e) => e.wrap("**", "**", t("components.markdown.boldPlaceholder")),
    },
    {
      label: "I",
      title: t("components.markdown.italic"),
      run: (e) => e.wrap("*", "*", t("components.markdown.italicPlaceholder")),
    },
    {
      label: "S",
      title: t("components.markdown.strikethrough"),
      run: (e) => e.wrap("~~", "~~", t("components.markdown.strikethroughPlaceholder")),
    },
    {
      label: "==",
      title: t("components.markdown.highlight"),
      run: (e) => e.wrap("==", "==", t("components.markdown.highlightPlaceholder")),
    },
    { label: "H2", title: t("components.markdown.heading"), run: (e) => e.lines("## ") },
    {
      icon: "list",
      title: t("components.markdown.bulletList"),
      run: (e) => e.lines("- "),
    },
    {
      label: "1.",
      title: t("components.markdown.numberedList"),
      run: (e) => e.lines("", { ordered: true }),
    },
    {
      icon: "check",
      title: t("components.markdown.taskList"),
      run: (e) => e.lines("- [ ] "),
    },
    {
      icon: "note",
      title: t("components.markdown.quote"),
      run: (e) => e.lines("> "),
    },
    {
      icon: "flag",
      title: t("components.markdown.callout"),
      run: (e) => e.lines("> [!tips] "),
    },
    {
      label: "`",
      title: t("components.markdown.inlineCode"),
      run: (e) => e.wrap("`", "`", t("components.markdown.inlineCodePlaceholder")),
    },
    {
      label: "</>",
      title: t("components.markdown.codeBlock"),
      run: (e) => {
        const { start } = e.read();
        e.insert("\n```\n\n```\n");
        e.select(start + 5, 0);
      },
    },
    {
      icon: "arrowRight",
      title: t("components.markdown.link"),
      run: (e) => {
        const { value: current, start, end } = e.read();
        const text =
          current.slice(start, end) || t("components.markdown.linkPlaceholder");
        e.insert(`[${text}](https://)`);
        e.select(start + text.length + 3, 8);
      },
    },
    {
      icon: "grid",
      title: t("components.markdown.table"),
      run: (e) => e.insert(t("components.markdown.tableTemplate")),
    },
    {
      label: "[^]",
      title: t("components.markdown.footnote"),
      run: (e) => {
        const { value: current, start } = e.read();
        const used = [...current.matchAll(/\[\^(\d+)\]/g)].map((match) => Number(match[1]));
        const n = used.length > 0 ? Math.max(...used) + 1 : 1;
        const inserted = `[^${n}]\n\n[^${n}]: `;
        e.insert(inserted);
        e.select(start + inserted.length, 0);
      },
    },
    {
      label: "%%",
      title: t("components.markdown.comment"),
      run: (e) => e.wrap("%%", "%%", t("components.markdown.commentPlaceholder")),
    },
    {
      label: "—",
      title: t("components.markdown.horizontalRule"),
      run: (e) => e.insert("\n\n---\n\n"),
    },
  ];

  /** Oppdaterer teksten og varsler skjemaet rundt. */
  const update = (next: string) => {
    setValue(next);
    onChange?.(next);
  };

  // Markøren må settes tilbake etter at React har tegnet den nye teksten.
  useEffect(() => {
    const area = areaRef.current;
    const wanted = wantedSelection.current;
    if (!area || !wanted) return;
    wantedSelection.current = null;
    area.focus();
    area.setSelectionRange(wanted.start, wanted.start + wanted.length);
  }, [value]);

  const api: EditorApi = {
    read: () => {
      const area = areaRef.current;
      return {
        value: area?.value ?? value,
        start: area?.selectionStart ?? 0,
        end: area?.selectionEnd ?? 0,
      };
    },
    select: (start, length) => {
      wantedSelection.current = { start, length };
      // Utløser effekten over selv om teksten er den samme som før.
      setValue((current) => current);
      const area = areaRef.current;
      if (area) {
        area.focus();
        area.setSelectionRange(start, start + length);
      }
    },
    insert: (text) => {
      const area = areaRef.current;
      if (!area) return;
      area.focus();

      // execCommand bevarer angre (Ctrl+Z); React fanger opp endringen selv.
      let inserted = false;
      try {
        inserted = document.execCommand("insertText", false, text);
      } catch {
        inserted = false;
      }
      if (!inserted) {
        const { start, end } = api.read();
        update(`${value.slice(0, start)}${text}${value.slice(end)}`);
        wantedSelection.current = { start: start + text.length, length: 0 };
      }
    },
    wrap: (before, after, placeholderText = t("components.markdown.defaultPlaceholder")) => {
      const { value: current, start, end } = api.read();
      const selected = current.slice(start, end) || placeholderText;
      api.insert(`${before}${selected}${after}`);
      api.select(start + before.length, selected.length);
    },
    lines: (prefix, options = {}) => {
      const { value: current, start, end } = api.read();
      const lineStart = current.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const nextBreak = current.indexOf("\n", end);
      const lineEnd = nextBreak === -1 ? current.length : nextBreak;
      const block = current.slice(lineStart, lineEnd);
      const lines = block.split("\n");

      const wanted = lines.map((line, index) =>
        options.ordered ? `${index + 1}. ${line}` : `${prefix}${line}`,
      );
      const pattern = options.ordered ? /^\d+\. / : new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
      const alreadyDone = lines.every((line) => line.trim() === "" || pattern.test(line));
      const replacement = (alreadyDone ? lines.map((line) => line.replace(pattern, "")) : wanted).join("\n");

      const area = areaRef.current;
      if (area) area.setSelectionRange(lineStart, lineEnd);
      api.insert(replacement);
      api.select(lineStart, replacement.length);
    },
  };

  const runButton = (button: ToolbarButton) => button.run(api);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const button = {
      b: buttons[0],
      i: buttons[1],
      k: buttons[12],
    }[key];
    if (!button) return;
    event.preventDefault();
    runButton(button);
  };

  const inputId = id ?? `markdown-${name}`;
  const previewId = `${inputId}-preview`;

  return (
    <div className={className}>
      <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] focus-within:border-[var(--ink,#101310)] focus-within:ring-2 focus-within:ring-[var(--signal,#d8ff3e)] [--focus-ring:var(--ink,#101310)]">
        <div
          role="toolbar"
          aria-label={t("components.markdown.toolbar")}
          className="flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-1.5 py-1"
        >
          {buttons.map((button) => (
            <button
              key={button.title}
              type="button"
              title={button.title}
              aria-label={button.title}
              aria-controls={inputId}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runButton(button)}
              disabled={disabled}
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg px-1.5 py-1 font-mono text-xs font-bold text-[var(--muted,#62685f)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] disabled:opacity-40"
            >
              {button.icon ? (
                <Icon name={button.icon} className="h-4 w-4" />
              ) : (
                <span aria-hidden>{button.label}</span>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPreview((current) => !current)}
            aria-pressed={preview}
            aria-controls={preview ? previewId : undefined}
            className={`ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold transition ${
              preview
                ? "bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                : "text-[var(--muted,#62685f)] hover:bg-[var(--surface,#fffdf8)] hover:text-[var(--ink,#101310)]"
            }`}
          >
            <Icon name="file" className="h-3.5 w-3.5" />
            {t("components.markdown.preview")}
          </button>
        </div>

        <textarea
          ref={areaRef}
          id={inputId}
          name={name}
          rows={rows}
          required={required}
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={(event) => update(event.target.value)}
          onKeyDown={onKeyDown}
          className="w-full resize-y rounded-b-xl bg-[var(--surface,#fffdf8)] px-3 py-2 font-mono text-sm text-[var(--ink,#101310)] outline-none disabled:bg-[var(--paper,#f2efe6)] disabled:text-[var(--muted,#62685f)]"
        />
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted,#62685f)]">
        <span>
          {t("components.markdown.supports")}{" "}
          <code className="rounded border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-1 text-[var(--ink,#101310)]">**fet**</code>,{" "}
          <code className="rounded border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-1 text-[var(--ink,#101310)]">==utheving==</code>,{" "}
          <code className="rounded border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-1 text-[var(--ink,#101310)]">- liste</code>,{" "}
          <code className="rounded border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-1 text-[var(--ink,#101310)]">&gt; [!tips]</code>
        </span>
        <a
          href="https://obsidian.md/help/syntax"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 hover:text-[var(--ink,#101310)]"
        >
          {t("components.markdown.allSyntax")}
        </a>
      </div>

      {preview && (
        <div id={previewId} className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3">
          {value.trim() ? (
            <MarkdownView value={value} />
          ) : (
            <p className="text-sm text-[var(--muted,#62685f)]">{t("components.markdown.nothingToPreview")}</p>
          )}
        </div>
      )}
    </div>
  );
}
