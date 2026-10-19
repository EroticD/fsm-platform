import { describe, expect, it } from "vitest";
import { formatAddress } from "@/lib/address";

describe("formatAddress", () => {
  it("setter sammen gate, postnummer og sted", () => {
    expect(
      formatAddress({ address: "Storgata 1", postalCode: "6002", city: "Ålesund" }),
    ).toBe("Storgata 1, 6002 Ålesund");
  });

  it("utelater tomme deler", () => {
    expect(formatAddress({ address: "Storgata 1", postalCode: "", city: "" })).toBe(
      "Storgata 1",
    );
    expect(formatAddress({ address: null, postalCode: "6002", city: "Ålesund" })).toBe(
      "6002 Ålesund",
    );
  });

  it("returnerer tom streng uten kunde", () => {
    expect(formatAddress(null)).toBe("");
    expect(formatAddress(undefined)).toBe("");
  });
});
