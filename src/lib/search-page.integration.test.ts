import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { searchDocuments } from "@/lib/search-sql";
import { integrationEnabled, unique } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

/**
 * Verifiserer at indeksert sidetekst gir riktig PDF-side i treffet, slik at
 * søkeresultatet kan lenke til `#page=N`.
 */
describeIntegration("searchDocuments – side i PDF", () => {
  const marker = unique("HydrauliskPumpe").replace(/-/g, "");
  let documentId = "";

  beforeAll(async () => {
    const document = await prisma.document.create({
      data: {
        title: unique("SideTest dokument"),
        fileName: `${marker}.pdf`,
        filePath: `/tmp/${marker}.pdf`,
        mimeType: "application/pdf",
        fileSize: 100,
        contentText: [
          "Første side handler om noe helt annet.",
          `Andre side nevner også service.`,
          `Tredje side inneholder ${marker} og hydraulikk.`,
        ].join("\n"),
        pageTexts: JSON.stringify([
          { page: 1, text: "Første side handler om noe helt annet." },
          { page: 2, text: "Andre side nevner også service." },
          {
            page: 3,
            text: `Tredje side inneholder ${marker} og hydraulikk.`,
          },
        ]),
      },
      select: { id: true },
    });
    documentId = document.id;
  });

  afterAll(async () => {
    if (documentId) {
      await prisma.document.deleteMany({ where: { id: documentId } });
    }
  });

  it("returnerer første side som matcher indeksert tekst", async () => {
    const hits = await searchDocuments(marker, 10);
    const hit = hits.find((row) => row.id === documentId);

    expect(hit).toBeDefined();
    expect(hit?.page).toBe(3);
  });
});
