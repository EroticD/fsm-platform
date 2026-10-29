import { describe, expect, it } from "vitest";
import { safeMarkdownUrl } from "./markdown";

describe("safeMarkdownUrl", () => {
  it("godtar https, http, mailto, tel og anker", () => {
    expect(safeMarkdownUrl("https://example.com/rapport?x=1#del")).toBe(
      "https://example.com/rapport?x=1#del",
    );
    expect(safeMarkdownUrl("http://example.com")).toBe("http://example.com/");
    expect(safeMarkdownUrl("mailto:post@example.com")).toBe(
      "mailto:post@example.com",
    );
    expect(safeMarkdownUrl("tel:+4712345678")).toBe("tel:+4712345678");
    expect(safeMarkdownUrl("#side-2")).toBe("#side-2");
  });

  it("avviser aktive og lokale protokoller", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      "/uploads/hemmelig.pdf",
      "../rapport.pdf",
      "//example.com/rapport",
      "",
    ]) {
      expect(safeMarkdownUrl(url), url).toBeNull();
    }
  });

  it("avviser URL-er med innloggingsinfo", () => {
    expect(safeMarkdownUrl("https://bruker:pass@example.com")).toBeNull();
  });

  it("normaliserer kontrolltegn og store bokstaver i protokollen", () => {
    expect(safeMarkdownUrl("HTTPS://example.com")).toBe("https://example.com/");
    expect(safeMarkdownUrl("java\nscript:alert(1)")).toBeNull();
  });
});
