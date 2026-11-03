import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ScannerNotice from "./ScannerNotice";

describe("ScannerNotice", () => {
  it.each(["unsupported", "denied", "unavailable", "error"] as const)(
    "renders %s as an assertive alert",
    (kind) => {
      const html = renderToStaticMarkup(
        createElement(ScannerNotice, { kind }, "Kunne ikke skanne"),
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain('aria-live="assertive"');
      expect(html).toContain(`data-scanner-state="${kind}"`);
      expect(html).toContain("Kunne ikke skanne");
    },
  );

  it("renders duplicate and info as polite status messages", () => {
    for (const kind of ["duplicate", "info"] as const) {
      const html = renderToStaticMarkup(
        createElement(ScannerNotice, { kind }, "Prøv en annen kode"),
      );

      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain(`data-scanner-state="${kind}"`);
    }
  });

  it("renders nothing without a message", () => {
    expect(renderToStaticMarkup(createElement(ScannerNotice, { kind: "error" }))).toBe(
      "",
    );
  });
});
