import { describe, expect, it } from "vitest";
import { uploadErrorMessage, uploadFailureText } from "./upload-error";

const t = (key: string) => `tekst:${key}`;

describe("uploadErrorMessage", () => {
  it("bruker den lokaliserte messageKey fra appens svar", () => {
    expect(
      uploadErrorMessage(
        { status: 507 },
        {
          error: "storage_quota_exceeded",
          messageKey: "errors.api.upload.quota",
          message: "quota",
        },
        t,
        "generisk",
      ),
    ).toBe("tekst:errors.api.upload.quota");
  });

  it.each([
    [413, "errors.api.upload.tooLarge"],
    [415, "errors.api.upload.invalidType"],
    [429, "errors.api.upload.rateLimited"],
    [503, "errors.api.upload.busy"],
    [507, "errors.api.upload.quota"],
  ])(
    "oversetter status %i når proxyen ikke returnerer JSON",
    (status, key) => {
      expect(uploadErrorMessage({ status }, {}, t, "generisk")).toBe(
        `tekst:${key}`,
      );
    },
  );

  it("faller tilbake til den lokale teksten for ukjente feil", () => {
    expect(uploadErrorMessage({ status: 500 }, {}, t, "generisk")).toBe(
      "generisk",
    );
  });
});

describe("uploadFailureText", () => {
  const one = (name: string) => `én:${name}`;
  const many = (count: number, names: string) => `mange:${count}:${names}`;

  it("viser den faktiske årsaken for én fil", () => {
    expect(
      uploadFailureText(
        [{ name: "bilde.png", message: "tekst:errors.api.upload.quota" }],
        one,
        many,
      ),
    ).toBe("tekst:errors.api.upload.quota");
  });

  it("beholder både antall, navn og unike årsaker for flere filer", () => {
    expect(
      uploadFailureText(
        [
          { name: "a.pdf", message: "tekst:errors.api.upload.tooLarge" },
          { name: "b.pdf", message: "tekst:errors.api.upload.tooLarge" },
          { name: "c.pdf", message: "tekst:errors.api.upload.busy" },
        ],
        one,
        many,
      ),
    ).toBe(
      "mange:3:a.pdf, b.pdf, c.pdf tekst:errors.api.upload.tooLarge tekst:errors.api.upload.busy",
    );
  });

  it("bruker lokal fallback når serveren ikke ga en årsak", () => {
    expect(
      uploadFailureText([{ name: "a.pdf", message: "" }], one, many),
    ).toBe("én:a.pdf");
  });
});
