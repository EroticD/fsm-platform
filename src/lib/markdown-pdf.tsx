import { Link, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { markdownToMdast } from "./markdown";
import { calloutType } from "./markdown-obsidian";

/**
 * Tegner Markdown i servicerapporten.
 *
 * react-pdf forstår ikke HTML, så teksten gjøres om til react-pdf-elementer på
 * samme måte som `MarkdownView` gjør det for nettsiden – begge bygger på
 * mdast-treet fra lib/markdown.ts.
 *
 * Vi unngår bevisst `wrap={false}`: en blokk som er høyere enn en side ødelegger
 * tekstplasseringen i react-pdf (se git-historikken).
 */

const styles = StyleSheet.create({
  paragraph: { marginBottom: 3 },
  heading: { marginTop: 6, marginBottom: 3 },
  list: { marginBottom: 3 },
  listItem: { flexDirection: "row", marginBottom: 1 },
  listMarker: { width: 14, flexShrink: 0 },
  listBody: { flex: 1 },
  code: { backgroundColor: "#f3f4f6", padding: 6, marginBottom: 4, borderRadius: 2 },
  codeText: { fontFamily: "Courier", fontSize: 8.5, lineHeight: 1.35 },
  inlineCode: { fontFamily: "Courier", fontSize: 9, backgroundColor: "#f3f4f6" },
  quote: { borderLeftWidth: 3, borderLeftColor: "#d1d5db", paddingLeft: 8, marginBottom: 3, color: "#4b5563" },
  hr: { borderBottomWidth: 1, borderBottomColor: "#d1d5db", marginTop: 5, marginBottom: 5 },
  table: { marginBottom: 5 },
  tableRow: { flexDirection: "row" },
  tableCell: { flex: 1, padding: 3, borderWidth: 0.5, borderColor: "#d1d5db" },
  tableHeader: { backgroundColor: "#f3f4f6" },
  tableText: { fontSize: 9, lineHeight: 1.3 },
  callout: { borderLeftWidth: 3, paddingLeft: 8, paddingTop: 5, paddingBottom: 5, marginBottom: 5 },
  calloutTitle: { fontWeight: "bold", marginBottom: 2 },
  mark: { backgroundColor: "#fef08a" },
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" },
  strike: { textDecoration: "line-through" },
  link: { color: "#1d4ed8", textDecoration: "underline" },
  muted: { color: "#6b7280" },
  footnoteRef: { fontSize: 8, color: "#1d4ed8" },
  footnote: { marginTop: 2, fontSize: 8, color: "#6b7280" },
});

type PdfStyle = (typeof styles)[keyof typeof styles];

/**
 * Tegnene de innebygde PDF-fontene har glyfer for (WinAnsi). Emoji og andre
 * symboler mangler helt, og uten dette ville de blitt stående som søppel i
 * rapporten – derfor fjernes de i stedet.
 */
const UNSUPPORTED_PDF_CHARS =
  /[^\t\n\r\u0020-\u007e\u00a0-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/g;

const pdfText = (value: string) => value.replace(UNSUPPORTED_PDF_CHARS, "");

/** Emojien i en callout-tittel har ingen glyf i PDF-en; fjern den med luften sin. */
const withoutLeadingEmoji = (value: string) =>
  value.replace(/^[\p{Extended_Pictographic}\u200d\uFE0F]+\s*/u, "");

/** Farger per callout-type, i samme inndeling som på nettsiden. */
const CALLOUT_COLORS: Record<string, { border: string; background: string; title: string }> = {
  note: { border: "#60a5fa", background: "#eff6ff", title: "#1e3a8a" },
  info: { border: "#60a5fa", background: "#eff6ff", title: "#1e3a8a" },
  tip: { border: "#2dd4bf", background: "#f0fdfa", title: "#134e4a" },
  success: { border: "#4ade80", background: "#f0fdf4", title: "#14532d" },
  question: { border: "#fbbf24", background: "#fffbeb", title: "#78350f" },
  warning: { border: "#facc15", background: "#fefce8", title: "#713f12" },
  failure: { border: "#f87171", background: "#fef2f2", title: "#7f1d1d" },
  danger: { border: "#ef4444", background: "#fef2f2", title: "#7f1d1d" },
  bug: { border: "#f87171", background: "#fef2f2", title: "#7f1d1d" },
  example: { border: "#c084fc", background: "#faf5ff", title: "#581c87" },
  quote: { border: "#9ca3af", background: "#f9fafb", title: "#111827" },
  abstract: { border: "#38bdf8", background: "#f0f9ff", title: "#0c4a6e" },
  todo: { border: "#38bdf8", background: "#f0f9ff", title: "#0c4a6e" },
};

/** Et mdast-tre sett fra tegneren. Vi trenger bare feltene vi faktisk bruker. */
type MdNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  checked?: boolean | null;
  align?: Array<"left" | "right" | "center" | null>;
  identifier?: string;
  label?: string;
  data?: { hProperties?: { className?: string[] } };
  children?: MdNode[];
};

const children = (node: MdNode): MdNode[] => node.children ?? [];

/** Callout-typen ligger som klasse på noden (se markdown-obsidian.ts). */
const calloutOf = (node: MdNode): string | null => {
  const className = node.data?.hProperties?.className ?? [];
  const match = className.find((name) => name.startsWith("callout-"));
  return match ? calloutType(match.replace("callout-", "")) : null;
};

/** Teksten inne i et avsnitt, en overskrift eller en tabellcelle. */
function inline(nodes: MdNode[], key: string): ReactNode[] {
  return nodes.map((node, index) => {
    const nodeKey = `${key}-${index}`;
    switch (node.type) {
      case "text":
        return <Text key={nodeKey}>{pdfText(node.value ?? "")}</Text>;
      case "strong":
        return (
          <Text key={nodeKey} style={styles.bold}>
            {inline(children(node), nodeKey)}
          </Text>
        );
      case "emphasis":
        return (
          <Text key={nodeKey} style={styles.italic}>
            {inline(children(node), nodeKey)}
          </Text>
        );
      case "delete":
        return (
          <Text key={nodeKey} style={styles.strike}>
            {inline(children(node), nodeKey)}
          </Text>
        );
      case "obsidianHighlight":
        return (
          <Text key={nodeKey} style={styles.mark}>
            {inline(children(node), nodeKey)}
          </Text>
        );
      case "inlineCode":
        return (
          <Text key={nodeKey} style={styles.inlineCode}>
            {pdfText(node.value ?? "")}
          </Text>
        );
      case "link":
        return (
          <Link key={nodeKey} src={node.url ?? ""} style={styles.link}>
            {inline(children(node), nodeKey)}
          </Link>
        );
      case "break":
        return <Text key={nodeKey}>{"\n"}</Text>;
      case "image":
        return (
          <Text key={nodeKey} style={styles.muted}>
            {`[${pdfText(node.alt || "bilde")}]`}
          </Text>
        );
      case "footnoteReference":
        return (
          <Text key={nodeKey} style={styles.footnoteRef}>
            {`[${node.label ?? node.identifier ?? "?"}]`}
          </Text>
        );
      default:
        return null;
    }
  });
}

function blockNode(node: MdNode, key: string, base?: PdfStyle): ReactNode {
  switch (node.type) {
    case "heading": {
      const size = { 1: 15, 2: 13, 3: 12, 4: 11, 5: 10, 6: 10 }[node.depth ?? 1] ?? 12;
      return (
        <View key={key} style={styles.heading}>
          <Text style={[base, { fontSize: size, fontWeight: "bold" }]}>{inline(children(node), key)}</Text>
        </View>
      );
    }

    case "paragraph":
      return (
        <View key={key} style={styles.paragraph}>
          <Text style={base}>{inline(children(node), key)}</Text>
        </View>
      );

    case "list": {
      const start = node.start ?? 1;
      return (
        <View key={key} style={styles.list}>
          {children(node).map((item, index) => (
            <View key={`${key}-${index}`} style={styles.listItem}>
              <Text style={styles.listMarker}>
                {item.checked === true
                  ? "[x]"
                  : item.checked === false
                    ? "[ ]"
                    : node.ordered
                      ? `${start + index}.`
                      : "•"}
              </Text>
              <View style={styles.listBody}>
                {blocks(children(item), `${key}-${index}`, base)}
              </View>
            </View>
          ))}
        </View>
      );
    }

    case "code":
      return (
        <View key={key} style={styles.code}>
          <Text style={styles.codeText}>{pdfText(node.value ?? "")}</Text>
        </View>
      );

    case "blockquote":
      return (
        <View key={key} style={styles.quote}>
          {blocks(children(node), key, base)}
        </View>
      );

    case "table": {
      const rows = children(node);
      return (
        <View key={key} style={styles.table}>
          {rows.map((row, rowIndex) => (
            <View key={`${key}-${rowIndex}`} style={styles.tableRow}>
              {children(row).map((cell, cellIndex) => {
                const align = node.align?.[cellIndex];
                return (
                  <View
                    key={`${key}-${rowIndex}-${cellIndex}`}
                    style={[styles.tableCell, rowIndex === 0 ? styles.tableHeader : {}]}
                  >
                    <Text
                      style={[
                        styles.tableText,
                        rowIndex === 0 ? styles.bold : {},
                        align === "center" ? { textAlign: "center" } : {},
                        align === "right" ? { textAlign: "right" } : {},
                      ]}
                    >
                      {inline(children(cell), `${key}-${rowIndex}-${cellIndex}`)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      );
    }

    case "thematicBreak":
      return <View key={key} style={styles.hr} />;

    case "obsidianCallout": {
      const [title, ...body] = children(node);
      const colors = CALLOUT_COLORS[calloutOf(node) ?? "note"] ?? CALLOUT_COLORS.note;
      // Emojien i tittelen («🔥 Før du starter») har ingen glyf i PDF-fonten.
      const titleNodes = children(title ?? ({} as MdNode)).map((child) =>
        child.type === "text" ? { ...child, value: withoutLeadingEmoji(child.value ?? "") } : child,
      );
      return (
        <View key={key} style={[styles.callout, { borderLeftColor: colors.border, backgroundColor: colors.background }]}>
          {title?.type === "obsidianCalloutTitle" ? (
            <Text style={[styles.calloutTitle, { color: colors.title }]}>{inline(titleNodes, key)}</Text>
          ) : null}
          {blocks(body, `${key}-body`, base)}
        </View>
      );
    }

    case "footnoteDefinition":
      return (
        <View key={key} style={styles.footnote}>
          <Text>
            {`[${node.label ?? node.identifier ?? "?"}] `}
            {inline(children(children(node)[0] ?? node), key)}
          </Text>
        </View>
      );

    case "html":
      return null;

    default:
      return children(node).length > 0 ? (
        <View key={key}>{blocks(children(node), key, base)}</View>
      ) : null;
  }
}

function blocks(nodes: MdNode[], key: string, base?: PdfStyle): ReactNode[] {
  return nodes.map((node, index) => blockNode(node, `${key}-${index}`, base));
}

/**
 * Markdown som react-pdf-innhold. `base` er stilen teksten arver fra der den
 * brukes (for eksempel `styles.value` i ReportDocument).
 */
export function MarkdownPdf({
  value,
  base,
}: {
  value: string | null | undefined;
  base?: PdfStyle;
}): ReactNode {
  if (!value || value.trim().length === 0) return null;
  const tree = markdownToMdast(value) as unknown as MdNode;
  return <View>{blocks(children(tree), "md", base)}</View>;
}
