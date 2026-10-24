import { describe, expect, it } from "vitest";
import {
  cleanDataImage,
  cleanEmail,
  cleanMarkdown,
  cleanStatus,
  cleanText,
  cleanUrl,
  escapeHtml,
} from "@/lib/sanitize";

describe("cleanText", () => {
  it("fjerner HTML og skriptinnhold", () => {
    expect(cleanText("<b>Hei</b> på deg")).toBe("Hei på deg");
    expect(cleanText('Hei<script>alert("x")</script>')).toBe("Hei");
    expect(cleanText("Hei<!-- kommentar -->")).toBe("Hei");
  });

  it("fjerner kontrolltegn og slår sammen mellomrom", () => {
    expect(cleanText("  Hei\u0000   på\tdeg  ")).toBe("Hei på deg");
  });

  it("beholder linjeskift når multiline er satt", () => {
    expect(cleanText("Linje 1\nLinje 2", { multiline: true })).toBe(
      "Linje 1\nLinje 2",
    );
    expect(cleanText("Linje 1\nLinje 2")).toBe("Linje 1 Linje 2");
  });

  it("kutter til maksimal lengde", () => {
    expect(cleanText("abcdef", { maxLength: 3 })).toBe("abc");
  });

  it("behandler ikke-tekstverdier som tomme", () => {
    expect(cleanText(null)).toBe("");
    expect(cleanText(undefined)).toBe("");
  });
});

describe("cleanMarkdown", () => {
  it("beholder Markdown og linjeskift, men fjerner HTML", () => {
    const value = "# Tittel\n\n**fet** og <script>alert(1)</script>";
    expect(cleanMarkdown(value)).toBe("# Tittel\n\n**fet** og");
  });

  it("reduserer mange tomme linjer", () => {
    expect(cleanMarkdown("a\n\n\n\n\nb")).toBe("a\n\n\nb");
  });
});

describe("cleanEmail", () => {
  it("normaliserer gyldige adresser", () => {
    expect(cleanEmail("  Kari@Firma.NO ")).toBe("kari@firma.no");
  });

  it("avviser ugyldige adresser", () => {
    expect(cleanEmail("ikke-en-epost")).toBe("");
    expect(cleanEmail("a@b")).toBe("");
  });
});

describe("cleanUrl", () => {
  it("godtar http(s) og interne stier", () => {
    expect(cleanUrl("https://example.com/logo.png")).toBe(
      "https://example.com/logo.png",
    );
    expect(cleanUrl("/uploads/bilde.png")).toBe("/uploads/bilde.png");
  });

  it("avviser farlige skjemaer", () => {
    expect(cleanUrl("javascript:alert(1)")).toBe("");
    expect(cleanUrl("data:text/html,hei")).toBe("");
  });
});

describe("cleanStatus", () => {
  it("godtar kjente statuser", () => {
    expect(cleanStatus("in_progress")).toBe("IN_PROGRESS");
  });

  it("avviser ukjente statuser", () => {
    expect(cleanStatus("UKJENT")).toBe("");
  });
});

describe("cleanDataImage", () => {
  it("godtar PNG-data og avviser andre data-URL-er", () => {
    expect(cleanDataImage("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect(cleanDataImage("data:text/html;base64,SGVsbG8=")).toBe("");
  });
});

describe("escapeHtml", () => {
  it("escaper HTML-tegn", () => {
    expect(escapeHtml('<a href="x">')).toBe("&lt;a href=&quot;x&quot;&gt;");
  });
});
