import { describe, expect, it } from "vitest";
import { collectReportImageUrls } from "./report-images";

describe("collectReportImageUrls", () => {
  it("tar med signaturbilder slik at PDF-en kan bygge dem inn", () => {
    const urls = collectReportImageUrls([
      {
        dataJson: JSON.stringify({ answers: {} }),
        technicianSignatureUrl: "/uploads/tekniker.png",
        customerSignatureUrl: "/uploads/kunde.jpg",
        units: [],
      },
    ]);

    expect(urls).toEqual([
      "/uploads/tekniker.png",
      "/uploads/kunde.jpg",
    ]);
  });

  it("dedupliserer signaturer og vanlige vedlegg", () => {
    const urls = collectReportImageUrls([
      {
        dataJson: JSON.stringify({
          answers: { f1: "/uploads/tekniker.png" },
        }),
        technicianSignatureUrl: "/uploads/tekniker.png",
        units: [],
      },
    ]);

    expect(urls).toEqual(["/uploads/tekniker.png"]);
  });
});
