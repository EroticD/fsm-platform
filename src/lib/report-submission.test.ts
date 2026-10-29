import { describe, expect, it } from "vitest";
import { verifiedSubmittedTemplateId } from "./report-submission";

const reports = [
  { templateId: "t1", isLocked: true, deletedAt: null },
  { templateId: "t2", isLocked: false, deletedAt: null },
  { templateId: "t3", isLocked: true, deletedAt: new Date() },
];

describe("verifiedSubmittedTemplateId", () => {
  it("godtar bare en låst rapport for samme mal", () => {
    expect(verifiedSubmittedTemplateId("t1", reports)).toBe("t1");
  });

  it("avviser ulåst, slettet eller ukjent mal", () => {
    expect(verifiedSubmittedTemplateId("t2", reports)).toBeNull();
    expect(verifiedSubmittedTemplateId("t3", reports)).toBeNull();
    expect(verifiedSubmittedTemplateId("t4", reports)).toBeNull();
    expect(verifiedSubmittedTemplateId(undefined, reports)).toBeNull();
  });
});
