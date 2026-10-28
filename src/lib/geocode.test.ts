import { describe, expect, it } from "vitest";
import { addressHash, effectiveAddress } from "./geocode";

describe("geocode-adresse", () => {
  it("lar oppdragets adresse overstyre kundens adresse", () => {
    expect(
      effectiveAddress({
        address: "Storgata 1",
        postalCode: "6003",
        city: "Ålesund",
        customer: {
          address: "Kundegata 2",
          postalCode: "5003",
          city: "Bergen",
        },
      }),
    ).toMatchObject({
      address: "Storgata 1",
      postalCode: "6003",
      city: "Ålesund",
      query: "Storgata 1, 6003, Ålesund",
    });
  });

  it("faller tilbake til kundens adresse", () => {
    expect(
      effectiveAddress({
        customer: {
          address: "Kundegata 2",
          postalCode: "5003",
          city: "Bergen",
        },
      }).query,
    ).toBe("Kundegata 2, 5003, Bergen");
  });

  it("gir samme hash for normaliserte varianter", () => {
    expect(addressHash("Storgata 1, 6003, Ålesund")).toBe(
      addressHash("storgata 1 6003 alesund"),
    );
    expect(addressHash("")).toBeNull();
  });
});
