"use client";

import Markdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
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
  note: { box: "border-blue-400 bg-blue-50", title: "text-blue-900" },
  info: { box: "border-blue-400 bg-blue-50", title: "text-blue-900" },
  tip: { box: "border-teal-400 bg-teal-50", title: "text-teal-900" },
  success: { box: "border-green-400 bg-green-50", title: "text-green-900" },
  question: { box: "border-amber-400 bg-amber-50", title: "text-amber-900" },
  warning: { box: "border-yellow-400 bg-yellow-50", title: "text-yellow-900" },
  failure: { box: "border-red-400 bg-red-50", title: "text-red-900" },
  danger: { box: "border-red-500 bg-red-50", title: "text-red-900" },
  bug: { box: "border-red-400 bg-red-50", title: "text-red-900" },
  example: { box: "border-purple-400 bg-purple-50", title: "text-purple-900" },
  quote: { box: "border-gray-400 bg-gray-50", title: "text-gray-900" },
  abstract: { box: "border-sky-400 bg-sky-50", title: "text-sky-900" },
  todo: { box: "border-sky-400 bg-sky-50", title: "text-sky-900" },
};

/** Tekststørrelse på rotnoden; underoverskrifter og kode skalerer relativt. */
const SIZES: Record<"xs" | "sm" | "base" | "md", string> = {
  xs: "text-[11px] leading-snug",
  sm: "text-xs",
  base: "text-sm",
  md: "text-base",
};

const components: Components = {
  h1: ({ children }) => <h1 className="mt-3 mb-1 text-lg font-bold text-gray-900">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1 text-base font-bold text-gray-900">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-bold text-gray-900">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-semibold text-gray-800">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-2 mb-1 text-xs font-semibold text-gray-800">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-2 mb-1 text-xs font-semibold text-gray-600">{children}</h6>,
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-gray-600 line-through">{children}</del>,
  mark: ({ children }) => (
    <mark className="rounded bg-yellow-200 px-0.5 text-gray-900">{children}</mark>
  ),
  a: ({ href, title, children }) => {
    const external = Boolean(href && /^https?:/i.test(href));
    return (
      <a
        href={href}
        title={title}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className="font-medium text-blue-700 underline decoration-blue-300 hover:decoration-blue-700"
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
    <span aria-hidden className="select-none text-gray-500">
      {checked ? "☑" : "☐"}
    </span>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-4 border-gray-300 pl-3 text-gray-700 italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-t border-gray-200" />,
  code: ({ children }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] text-gray-900">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-gray-100 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit" tabIndex={0}>
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto" tabIndex={0}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-gray-200 px-2 py-1 text-left font-semibold text-gray-700">{children}</th>
  ),
  td: ({ children }) => <td className="border border-gray-200 px-2 py-1 align-top">{children}</td>,
  sup: ({ children }) => <sup className="text-[0.7em]">{children}</sup>,
  section: ({ children }) => (
    <section className="mt-3 border-t border-gray-200 pt-2 text-xs text-gray-600">{children}</section>
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
    <div className={`${SIZES[size]} text-inherit [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${className}`}>
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
