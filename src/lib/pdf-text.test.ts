import { afterEach, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "./pdf-text";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractPdfText – stivalidering", () => {
  it.each([
    "https://evil.example/ond.pdf",
    "//evil.example/ond.pdf",
    "/etc/passwd",
    "/dev/zero",
    "/uploads/../etc/passwd",
  ])("avviser stien %s uten å lese filen", async (filePath) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await extractPdfText(filePath);

    expect(result).toEqual({ text: "", pages: [] });
    expect(error).toHaveBeenCalled();
  });

  it("godtar en vanlig sti i opplastingsmappen, men hopper over manglende fil", async () => {
    const result = await extractPdfText(
      "/uploads/finnes-ikke-123456789.pdf",
    );

    expect(result).toEqual({ text: "", pages: [] });
  });
});
