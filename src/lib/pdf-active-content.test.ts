import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectPdfActiveContent,
  sanitizePdfActiveContent,
} from "./pdf-active-content";

/** Bygger en minimal, gyldig PDF med valgfri dokumenthandling. */
function buildPdf(options: { javascript?: boolean; embeddedFile?: boolean } = {}) {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${
      options.javascript ? " /OpenAction 4 0 R" : ""
    }${options.embeddedFile ? " /Names << /EmbeddedFiles 6 0 R >>" : ""} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R >>",
    options.javascript
      ? '<< /Type /Action /S /JavaScript /JS (app.alert("hei");) >>'
      : "<< >>",
    "<< /Length 35 >>\nstream\nBT /F1 12 Tf 20 100 Td (Test) Tj ET\nendstream",
    ...(options.embeddedFile
      ? [
          "<< /Type /Filespec /F (hemmelig.txt) /EF << /F 7 0 R >> >>",
          "<< /Type /EmbeddedFile /Length 5 >>\nstream\nhello\nendstream",
        ]
      : []),
  ];

  let output = "%PDF-1.7\n";
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}

const hasQpdf =
  spawnSync("qpdf", ["--version"], { stdio: "ignore" }).status === 0;

afterEach(() => {
  delete process.env.QPDF_PATH;
});

describe("detectPdfActiveContent", () => {
  it("finner JavaScript, Launch og EmbeddedFile", () => {
    const pdf = buildPdf({ javascript: true, embeddedFile: true });

    expect(detectPdfActiveContent(pdf)).toEqual(
      expect.arrayContaining(["/JavaScript", "/JS", "/EmbeddedFile"]),
    );
    expect(
      detectPdfActiveContent(
        Buffer.from("<< /Type /Action /S /Launch /F (cmd.exe) >>"),
      ),
    ).toContain("/Launch");
  });

  it("godkjenner en vanlig PDF uten aktive konstruksjoner", () => {
    expect(detectPdfActiveContent(buildPdf())).toEqual([]);
  });
});

describe("sanitizePdfActiveContent", () => {
  it("returnerer en ren PDF uendret uten å kjøre qpdf", async () => {
    const pdf = buildPdf();
    const result = await sanitizePdfActiveContent(pdf);

    expect(result).toMatchObject({ ok: true, stripped: false });
    if (result.ok) expect(result.buffer.equals(pdf)).toBe(true);
  });

  it.skipIf(!hasQpdf)(
    "fjerner JavaScript og innebygde filer med qpdf",
    async () => {
      const pdf = buildPdf({ javascript: true, embeddedFile: true });
      expect(detectPdfActiveContent(pdf).length).toBeGreaterThan(0);

      const result = await sanitizePdfActiveContent(pdf);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("forventet sanert PDF");
      expect(result.stripped).toBe(true);
      expect(result.buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(detectPdfActiveContent(result.buffer)).toEqual([]);
    },
  );

  it("feiler lukket når qpdf mangler", async () => {
    process.env.QPDF_PATH = "qpdf-finnes-ikke";

    const result = await sanitizePdfActiveContent(
      buildPdf({ javascript: true }),
    );

    expect(result).toEqual({ ok: false, reason: "sanitizer_unavailable" });
  });
});
