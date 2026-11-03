import { describe, expect, it } from "vitest";
import {
  bookingReferenceForWorkOrder,
  generateWorkOrderReference,
  isWorkOrderReference,
  workOrderReferenceFromId,
} from "./work-order-reference";

describe("work-order-reference", () => {
  it("genererer O-YYMMDD-XXXXXXXX med dato i Europe/Oslo", () => {
    // 30. oktober 2026 kl. 23:30 UTC er 31. oktober i Oslo (CET, UTC+1).
    const reference = generateWorkOrderReference(
      new Date("2026-10-30T23:30:00.000Z"),
      () => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
    );

    expect(reference).toBe("O-261031-ABCDEFGH");
    expect(isWorkOrderReference(reference)).toBe(true);
  });

  it("genererer åtte tegn fra hele alfabetet uten skilletegn i suffikset", () => {
    for (let index = 0; index < 25; index += 1) {
      expect(generateWorkOrderReference()).toMatch(/^O-\d{6}-[A-Z0-9]{8}$/);
    }
  });

  it("lager deterministisk referanse fra id og opprettelsesdato", () => {
    const createdAt = new Date("2026-01-05T12:00:00.000Z");

    const first = workOrderReferenceFromId("cm-work-order-id", createdAt);
    const second = workOrderReferenceFromId("cm-work-order-id", createdAt);

    expect(first).toBe(second);
    expect(first).toBe("O-260105-7012AA5C");
    expect(isWorkOrderReference(first)).toBe(true);
  });

  it("bruker Oslo-dato også når createdAt er rundt midnatt UTC", () => {
    const reference = workOrderReferenceFromId(
      "cm-work-order-id",
      new Date("2026-06-30T22:30:00.000Z"),
    );

    expect(reference.startsWith("O-260701-")).toBe(true);
  });

  it("beholder bestillingsreferansen som B-YYMMDD-XXXXXX", () => {
    const reference = bookingReferenceForWorkOrder(
      "cm123456abcdef",
      new Date("2026-10-30T10:00:00.000Z"),
    );

    expect(reference).toBe("B-261030-ABCDEF");
    expect(isWorkOrderReference(reference)).toBe(true);
  });

  it("avviser verdier som ikke er referanser", () => {
    expect(isWorkOrderReference("")).toBe(false);
    expect(isWorkOrderReference("O-1234-ABCDEFGH")).toBe(false);
    expect(isWorkOrderReference("X-261030-ABCDEFGH")).toBe(false);
    expect(isWorkOrderReference("O-261030-ABC")).toBe(false);
  });
});
