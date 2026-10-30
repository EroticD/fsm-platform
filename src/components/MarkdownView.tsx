"use client";

import Markdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import Icon from "@/components/icons";
import { markdownToPlainText, remarkPlugins, sanitizeSchema } from "@/lib/markdown";
import { prepareObsidianSource } from "@/lib/markdown-obsidian";

/**
 * Viser Markdown-tekst med Obsidian-syntaks.
 *
 * Innholdet blir aldri tolket som HTML – rå HTML i teksten blir droppet, og
 * resten går gjennom et stramt sanitizeringsskjema (se lib/markdown.ts). Det
 * er derfor trygt å vise tekst som er skrevet av hvem som helst.
 */

/** Farger og ramme per callout-type, som i Obsidian. */
const CALLOUT_STYLES: Record<string, { box: string; title: string }> = {
  note: {
    box: "border-[var(--info,#1d4ed8)] bg-[var(--info-surface,#eff6ff)]",
    title: "text-[var(--info,#1d4ed8)]",
  },
  info: {
    box: "border-[var(--info,#1d4ed8)] bg-[var(--info-surface,#eff6ff)]",
    title: "text-[var(--info,#1d4ed8)]",
  },
  tip: {
    box: "border-[var(--success,#166534)] bg-[var(--success-surface,#f0fdf4)]",
    title: "text-[var(--success,#166534)]",
  },
  success: {
    box: "border-[var(--success,#166534)] bg-[var(--success-surface,#f0fdf4)]",
    title: "text-[var(--success,#166534)]",
  },
  question: {
    box: "border-[var(--warning,#b45309)] bg-[var(--warning-surface,#fffbeb)]",
    title: "text-[var(--warning,#b45309)]",
  },
  warning: {
    box: "border-[var(--warning,#b45309)] bg-[var(--warning-surface,#fffbeb)]",
    title: "text-[var(--warning,#b45309)]",
  },
  failure: {
    box: "border-[var(--danger,#b91c1c)] bg-[var(--danger-surface,#fef2f2)]",
    title: "text-[var(--danger,#b91c1c)]",
  },
  danger: {
    box: "border-[var(--danger,#b91c1c)] bg-[var(--danger-surface,#fef2f2)]",
    title: "text-[var(--danger,#b91c1c)]",
  },
  bug: {
    box: "border-[var(--danger,#b91c1c)] bg-[var(--danger-surface,#fef2f2)]",
    title: "text-[var(--danger,#b91c1c)]",
  },
  example: {
    box: "border-[var(--ink,#101310)] bg-[var(--paper,#f2efe6)]",
    title: "text-[var(--ink,#101310)]",
  },
  quote: {
    box: "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]",
    title: "text-[var(--ink,#101310)]",
  },
  abstract: {
    box: "border-[var(--info,#1d4ed8)] bg-[var(--info-surface,#eff6ff)]",
    title: "text-[var(--info,#1d4ed8)]",
  },
  todo: {
    box: "border-[var(--info,#1d4ed8)] bg-[var(--info-surface,#eff6ff)]",
    title: "text-[var(--info,#1d4ed8)]",
  },
};

/** Tekststørrelse på rotnoden; underoverskrifter og kode skalerer relativt. */
const SIZES: Record<"xs" | "sm" | "base" | "md", string> = {
  xs: "text-[11px] leading-snug",
  sm: "text-xs",
  base: "text-sm",
  md: "text-base",
};

const components: Components = {
  h1: ({ children }) => <h1 className="mt-3 mb-1 text-lg font-bold text-[var(--ink,#101310)]">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1 text-base font-bold text-[var(--ink,#101310)]">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-bold text-[var(--ink,#101310)]">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-semibold text-[var(--ink,#101310)]">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-2 mb-1 text-xs font-semibold text-[var(--ink,#101310)]">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-2 mb-1 text-xs font-semibold text-[var(--muted,#62685f)]">{children}</h6>,
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-[var(--ink,#101310)]">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-[var(--muted,#62685f)] line-through">{children}</del>,
  mark: ({ children }) => (
    <mark className="rounded bg-[var(--signal,#d8ff3e)] px-0.5 text-[var(--ink,#101310)]">{children}</mark>
  ),
  a: ({ href, title, children }) => {
    const external = Boolean(href && /^https?:/i.test(href));
    return (
      <a
        href={href}
        title={title}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className="font-medium text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-2 transition hover:decoration-[var(--ink,#101310)]"
      >
        {children}
      </a>
    );
  },
  ul: ({ className, children }) => (
    <ul
      className={`my-1 space-y-0.5 pl-5 ${className?.includes("contains-task-list") ? "list-none pl-1" : "list-disc"}`}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ className, children }) => (
    <li className={`leading-relaxed ${className?.includes("task-list-item") ? "flex items-start gap-1.5" : ""}`}>
      {children}
    </li>
  ),
  input: ({ checked }) => (
    <span
      aria-hidden
      className={`mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 select-none items-center justify-center rounded-sm border ${
        checked
          ? "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
          : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-transparent"
      }`}
    >
      <Icon name="check" className="h-3 w-3" strokeWidth={2.5} />
    </span>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[var(--line,#dedcd1)] pl-3 text-[var(--muted,#62685f)] italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-t border-[var(--line,#dedcd1)]" />,
  code: ({ children }) => (
    <code className="rounded border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--ink,#101310)]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-[var(--ink,#101310)] p-3 text-xs leading-relaxed text-[var(--paper,#f2efe6)] [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit" tabIndex={0}>
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto" tabIndex={0}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[var(--paper,#f2efe6)]">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-[var(--line,#dedcd1)] px-2 py-1 text-left font-semibold text-[var(--ink,#101310)]">{children}</th>
  ),
  td: ({ children }) => <td className="border border-[var(--line,#dedcd1)] px-2 py-1 align-top">{children}</td>,
  sup: ({ children }) => <sup className="text-[0.7em]">{children}</sup>,
  section: ({ children }) => (
    <section className="mt-3 border-t border-[var(--line,#dedcd1)] pt-2 text-xs text-[var(--muted,#62685f)]">{children}</section>
  ),
  div: ({ className, children }) => {
    // Eneste div-er her er callouts (se markdown-obsidian.ts). Klassen kan være
    // «callout-tip», «callout-title callout-tip» eller bare «callout».
    const type =
      (className ?? "")
        .split(/\s+/)
        .map((name) => name.replace(/^callout-/, ""))
        .find((name) => name in CALLOUT_STYLES) ?? "note";
    const style = CALLOUT_STYLES[type] ?? CALLOUT_STYLES.note;

    if (className?.includes("callout-title")) {
      return <div className={`text-sm font-bold ${style.title}`}>{children}</div>;
    }
    if (className?.includes("callout")) {
      return <div className={`my-2 rounded-lg border-l-4 px-3 py-2 ${style.box}`}>{children}</div>;
    }
    return <div>{children}</div>;
  },
};

export default function MarkdownView({
  value,
  className = "",
  size = "base",
}: {
  value: string | null | undefined;
  className?: string;
  /** Tekststørrelse – innerste overskrifter og kode skalerer med denne. */
  size?: "xs" | "sm" | "base" | "md";
}) {
  if (!value || markdownToPlainText(value).length === 0) return null;

  return (
    <div className={`${SIZES[size]} text-inherit [--focus-ring:var(--ink,#101310)] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${className}`}>
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={components}
      >
        {prepareObsidianSource(value)}
      </Markdown>
    </div>
  );
}
