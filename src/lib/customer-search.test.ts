import { describe, expect, it } from "vitest";
import {
  CUSTOMER_SEARCH_FIELDS,
  customerSearchOr,
} from "@/lib/customer-search";

describe("customerSearchOr", () => {
  it("søker i alle feltene på kundekortet", () => {
    const where = customerSearchOr("Gardshol");

    expect(CUSTOMER_SEARCH_FIELDS).toEqual([
      "name",
      "customerNumber",
      "orgNumber",
      "phone",
      "email",
      "address",
      "postalCode",
      "city",
      "notes",
    ]);

    for (const field of CUSTOMER_SEARCH_FIELDS) {
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { [field]: { contains: "Gardshol", mode: "insensitive" } },
        ]),
      );
    }
    expect(where.OR).toHaveLength(CUSTOMER_SEARCH_FIELDS.length);
  });

  it("trimmer søkeordet og bevarer tegnsetting i telefon/org.nr", () => {
    expect(customerSearchOr("  +47 123 45 678  ")).toEqual({
      OR: expect.arrayContaining([
        { phone: { contains: "+47 123 45 678", mode: "insensitive" } },
      ]),
    });
  });

  it("returnerer tomt filter for tomt søk", () => {
    expect(customerSearchOr("   ")).toEqual({});
  });

  it("filtrerer ikke selv på deletedAt; kalleren bestemmer slettet-visningen", () => {
    expect(customerSearchOr("kari")).not.toHaveProperty("deletedAt");
  });
});
