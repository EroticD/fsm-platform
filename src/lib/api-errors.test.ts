import { describe, expect, it } from "vitest";
import {
  apiError,
  internalApiError,
  isApiErrorCode,
} from "./api-errors";

describe("apiError", () => {
  it("mapper kode til standardstatus og legger ved messageKey", async () => {
    const response = apiError("forbidden");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "Ingen tilgang.",
        messageKey: "errors.api.forbidden",
      },
    });
  });

  it("beholder en kontekstspesifikk nøkkel og detaljer", async () => {
    const response = apiError("validation_error", 400, {
      messageKey: "errors.api.workOrders.invalidStatusFilter",
      details: { field: "status" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Ugyldig statusfilter.",
        messageKey: "errors.api.workOrders.invalidStatusFilter",
        details: { field: "status" },
      },
    });
  });

  it("bruker eksplisitt fallback når klienten ikke kan oversette", async () => {
    const response = apiError("not_found", 404, {
      messageKey: "errors.api.visits.notFound",
      message: "Fant ikke visitten.",
    });

    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "Fant ikke visitten.",
        messageKey: "errors.api.visits.notFound",
      },
    });
  });

  it("gir interne feil en flat konvolutt med stabil kode", async () => {
    const response = internalApiError("too_large", 413);

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    await expect(response.json()).resolves.toEqual({
      error: "too_large",
      message: "The request is too large.",
      messageKey: "errors.api.tooLarge",
    });
  });

  it("gjenkjenner bare kjente koder", () => {
    expect(isApiErrorCode("forbidden")).toBe(true);
    expect(isApiErrorCode("invalid_origin")).toBe(true);
    expect(isApiErrorCode("not-a-code")).toBe(false);
    expect(isApiErrorCode(null)).toBe(false);
  });
});
