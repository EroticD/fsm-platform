import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { claimNextPdfTextJob, enqueuePdfText } from "@/lib/job-worker";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

describeIntegration("DocumentJob: kø og claim", () => {
  let documentId = "";

  beforeAll(async () => {
    // Integrasjonsdatabasen er dedikert; fjern eventuelle rester fra tidligere
    // kjøringer før vi tester claim-rekkefølgen.
    await prisma.documentJob.deleteMany({});

    const document = await prisma.document.create({
      data: {
        title: unique("IT-jobb"),
        fileName: "it-jobb.pdf",
        filePath: `/uploads/${unique("it-jobb")}.pdf`,
      },
    });
    documentId = document.id;
  });

  afterAll(async () => {
    await prisma.documentJob.deleteMany({ where: { documentId } });
    await prisma.document.deleteMany({ where: { id: documentId } });
  });

  it("legger jobben i køen og lar én worker claim den", async () => {
    const queued = await enqueuePdfText(documentId);
    expect(queued?.id).toBeTruthy();

    // Samme dokument skal ikke få en ny jobb mens den første er i kø.
    const duplicate = await enqueuePdfText(documentId);
    expect(duplicate?.id).toBe(queued?.id);

    const job = await claimNextPdfTextJob();
    expect(job?.documentId).toBe(documentId);
    expect(job?.status).toBe("RUNNING");
    expect(job?.attempts).toBe(1);
  });
});
