import { describe, expect, it } from "vitest";
import { apiError, apiJson } from "./api-response";

describe("apiJson", () => {
  it("pakker data og metadata med sikre cache-headere", async () => {
    const response = apiJson({ id: "1" }, { total: 1 }, 201);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      data: { id: "1" },
      meta: { total: 1 },
    });
  });

  it("godtar status som andre argument og utelater meta", async () => {
    const response = apiJson(["a"], 202);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ data: ["a"] });
  });
});

describe("apiError", () => {
  it("bruker stabil feilkode og valgfrie detaljer", async () => {
    const response = apiError(422, "validation_error", "Ugyldig", {
      field: "name",
    });

    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Ugyldig",
        details: { field: "name" },
      },
    });
  });

  it("utelater details når de ikke er oppgitt", async () => {
    const response = apiError(404, "not_found", "Fant ikke");

    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Fant ikke" },
    });
  });
});
