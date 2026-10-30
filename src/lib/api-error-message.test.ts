import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "./api-error-message";

const translate = (key: string) => {
  if (key === "errors.api.forbidden") return "Oversatt: ingen tilgang";
  throw new Error(`missing ${key}`);
};

describe("apiErrorMessage", () => {
  it("foretrekker messageKey fra intern konvolutt", () => {
    expect(
      apiErrorMessage({ error: "forbidden", messageKey: "errors.api.forbidden" }, translate, "Fallback"),
    ).toBe("Oversatt: ingen tilgang");
  });

  it("leser messageKey fra offentlig /api/v1-konvolutt", () => {
    expect(
      apiErrorMessage(
        { error: { code: "forbidden", messageKey: "errors.api.forbidden" } },
        translate,
        "Fallback",
      ),
    ).toBe("Oversatt: ingen tilgang");
  });

  it("faller tilbake til message og deretter lokal tekst", () => {
    expect(
      apiErrorMessage({ error: "forbidden", message: "Ingen tilgang" }, translate, "Fallback"),
    ).toBe("Ingen tilgang");
    expect(apiErrorMessage({ error: "forbidden" }, translate, "Fallback")).toBe(
      "Fallback",
    );
  });

  it("viser eldre fri tekst, men aldri en rå kode", () => {
    expect(apiErrorMessage({ error: "Ugyldig fil" }, translate, "Fallback")).toBe(
      "Ugyldig fil",
    );
    expect(apiErrorMessage({ error: "invalid_file" }, translate, "Fallback")).toBe(
      "Fallback",
    );
  });
});
