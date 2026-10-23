import { describe, expect, it } from "vitest";
import {
  dateOnlySchema,
  optionalDateOnlySchema,
  optionalIdSchema,
} from "./common";
import { workOrderCreateSchema, workOrderDateSchema } from "./workOrder";
import { reportUnlockSchema, reportSubmitSchema } from "./report";

describe("common-schema", () => {
  it("godtar ekte datoer og avviser ugyldige", () => {
    expect(dateOnlySchema.safeParse("2026-10-23").success).toBe(true);
    expect(dateOnlySchema.safeParse("2026-02-31").success).toBe(false);
    expect(dateOnlySchema.safeParse("23.10.2026").success).toBe(false);
  });

  it("gjør tomme valgfrie felt om til undefined", () => {
    expect(optionalIdSchema.parse("")).toBeUndefined();
    expect(optionalIdSchema.parse("abc")).toBe("abc");
    expect(optionalDateOnlySchema.parse("")).toBeUndefined();
  });
});

describe("workOrder-skjema", () => {
  it("avviser sluttdato før startdato", () => {
    const result = workOrderCreateSchema.safeParse({
      title: "Service",
      departmentId: "dep-1",
      scheduledFor: "2026-10-23",
      scheduledTo: "2026-10-22",
    });
    expect(result.success).toBe(false);
  });

  it("godtar et minimalt gyldig oppdrag", () => {
    const result = workOrderCreateSchema.safeParse({
      title: "Service",
      departmentId: "dep-1",
      scheduledFor: "2026-10-23",
    });
    expect(result.success).toBe(true);
  });

  it("godtar at kalenderen fjerner sluttdato", () => {
    const result = workOrderDateSchema.safeParse({
      newDate: "2026-10-23",
      newEnd: "",
    });
    expect(result.success).toBe(true);
  });
});

describe("report-skjema", () => {
  it("krever oppdrags- og mal-id", () => {
    expect(reportSubmitSchema.safeParse({ workOrderId: "", templateId: "" }).success).toBe(false);
  });

  it("tolker låseflagget til boolean", () => {
    expect(reportUnlockSchema.parse({ reportId: "r1", lock: "1" }).lock).toBe(true);
    expect(reportUnlockSchema.parse({ reportId: "r1", lock: "0" }).lock).toBe(false);
  });
});
