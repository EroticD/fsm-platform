import { afterAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import { enqueuePdfText, PDF_TEXT_JOB_TYPE } from "@/lib/job-worker";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("dokumentkø mot ekte PostgreSQL", () => {
  const documentId = unique("doc-kø");

  afterAll(async () => {
    await prisma.documentJob.deleteMany({ where: { documentId } });
  });

  it("er idempotent for samme dokument mens jobben venter", async () => {
    const first = await enqueuePdfText(documentId);
    const second = await enqueuePdfText(documentId);

    expect(first).not.toBeNull();
    expect(second?.id).toBe(first?.id);
    expect(
      await prisma.documentJob.count({
        where: { documentId, type: PDF_TEXT_JOB_TYPE, status: "PENDING" },
      }),
    ).toBe(1);
  });

  it("tåler to samtidige enqueue-kall uten å lage duplikater", async () => {
    const other = unique("doc-kø-samtidig");
    const results = await Promise.all([
      enqueuePdfText(other),
      enqueuePdfText(other),
    ]);
    expect(results[0]?.id).toBeTruthy();
    expect(
      await prisma.documentJob.count({
        where: { documentId: other, status: "PENDING" },
      }),
    ).toBeLessThanOrEqual(1);
    await prisma.documentJob.deleteMany({ where: { documentId: other } });
  });
});
