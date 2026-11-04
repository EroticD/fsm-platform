import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ScannerNotice from "./ScannerNotice";
import type { ScannerNoticeKind } from "@/lib/scanner-capability";

function render(kind: ScannerNoticeKind, children = "Melding") {
  return renderToStaticMarkup(
    createElement(ScannerNotice, { kind }, children),
  );
}

describe("ScannerNotice", () => {
  it.each([
    "unsupported",
    "insecure",
    "denied",
    "unavailable",
    "overconstrained",
    "busy",
    "decode",
    "loader-error",
    "error",
  ] as const)("viser %s som en tilgjengelig feilmelding", (kind) => {
    const html = render(kind);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain(`data-scanner-state="${kind}"`);
  });

  it("viser informasjon og duplikatvarsel uten alarm", () => {
    expect(render("info")).toContain('role="status"');
    expect(render("duplicate")).toContain('role="status"');
    expect(render("info")).not.toContain('role="alert"');
  });

  it("renderer ingenting uten tekst", () => {
    expect(
      renderToStaticMarkup(
        createElement(ScannerNotice, { kind: "insecure" }, ""),
      ),
    ).toBe("");
  });
});
