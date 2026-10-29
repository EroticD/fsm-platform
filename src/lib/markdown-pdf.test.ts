import { Link } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { MarkdownPdf } from "./markdown-pdf";

/** Finner alle react-pdf Link-elementer i treet, uten å rendre PDF-en. */
function links(node: unknown): unknown[] {
  if (!node || typeof node !== "object") return [];
  const element = node as { type?: unknown; props?: { children?: unknown } };
  const found = element.type === Link ? [node] : [];
  const children = element.props?.children;
  const list = Array.isArray(children) ? children : [children];
  return [...found, ...list.flatMap(links)];
}

describe("MarkdownPdf-lenker", () => {
  it("gjør javascript: om til ren tekst", () => {
    const tree = MarkdownPdf({ value: "[trykk](javascript:alert(1))" });

    expect(links(tree)).toHaveLength(0);
  });

  it("beholder vanlige https-lenker som klikkbare", () => {
    const tree = MarkdownPdf({ value: "[trykk](https://example.com/rapport)" });

    const found = links(tree) as Array<{ props: { src: string } }>;
    expect(found).toHaveLength(1);
    expect(found[0].props.src).toBe("https://example.com/rapport");
  });

  it("avviser data: og file: også i PDF-en", () => {
    const tree = MarkdownPdf({
      value: "[a](data:text/html,x) og [b](file:///etc/passwd)",
    });

    expect(links(tree)).toHaveLength(0);
  });
});
