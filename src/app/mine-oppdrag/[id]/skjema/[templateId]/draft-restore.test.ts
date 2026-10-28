import { describe, expect, it } from "vitest";
import {
  REPORT_WITHOUT_UNITS_KEY,
  restoreLocalDraft,
  type ReportSeed,
} from "./draft-restore";

function seed(overrides: Partial<ReportSeed> = {}): ReportSeed {
  return {
    notes: "servernotat",
    technicianSignatureUrl: "/uploads/tech.png",
    technicianName: "Server Tekniker",
    customerSignatureUrl: null,
    customerName: null,
    units: [],
    ...overrides,
  };
}

describe("restoreLocalDraft", () => {
  it("gjenoppretter alle skjemafelter fra lokal kladd", () => {
    const restored = restoreLocalDraft({
      requiresUnits: true,
      fallback: seed(),
      snapshot: {
        state: {
          counter: 2,
          units: [
            {
              key: "unit-0",
              productId: "prod1",
              label: "Port Nord",
              serialNumber: "SN-1",
              location: "Bygg A",
              status: "AVVIK",
              comment: "Enhetskommentar",
              answers: {
                f1: "tekst",
                f2: "2026-10-28",
                f3: 12,
                f4: "true",
                f5: "valg",
              },
            },
          ],
        },
        form: {
          notes: "lokalt notat",
          technicianName: "Lokal Tekniker",
          technicianSignature: "data:image/png;base64,abc",
          customerName: "Kunde K",
          customerSignature: "data:image/png;base64,def",
          "answer__unit-0__f1": "tekst",
        },
      },
    });

    expect(restored).not.toBeNull();
    expect(restored?.state.units[0]).toMatchObject({
      key: "unit-0",
      productId: "prod1",
      label: "Port Nord",
      serialNumber: "SN-1",
      location: "Bygg A",
      status: "AVVIK",
      comment: "Enhetskommentar",
      answers: {
        f1: "tekst",
        f2: "2026-10-28",
        f3: 12,
        f4: "true",
        f5: "valg",
      },
    });
    expect(restored?.seed).toMatchObject({
      notes: "lokalt notat",
      technicianName: "Lokal Tekniker",
      technicianSignatureUrl: "data:image/png;base64,abc",
      customerName: "Kunde K",
      customerSignatureUrl: "data:image/png;base64,def",
    });
  });

  it("beholder serververdier for felter som mangler lokalt", () => {
    const restored = restoreLocalDraft({
      requiresUnits: true,
      fallback: seed(),
      snapshot: {
        state: { counter: 1, units: [] },
        form: {},
      },
    });

    expect(restored?.seed.notes).toBe("servernotat");
    expect(restored?.seed.technicianName).toBe("Server Tekniker");
    expect(restored?.seed.technicianSignatureUrl).toBe("/uploads/tech.png");
  });

  it("legger svarene i den faste nøkkelen når malen ikke bruker enheter", () => {
    const restored = restoreLocalDraft({
      requiresUnits: false,
      snapshot: {
        state: {
          counter: 3,
          units: [
            {
              key: "unit-0",
              productId: "prod1",
              label: "Skal ignoreres",
              serialNumber: "",
              location: "",
              status: "AVVIK",
              comment: "Kommentar",
              answers: { f1: "svar" },
            },
          ],
        },
      },
    });

    expect(restored?.state.counter).toBe(1);
    expect(restored?.state.units).toHaveLength(1);
    expect(restored?.state.units[0]).toMatchObject({
      key: REPORT_WITHOUT_UNITS_KEY,
      productId: "",
      label: "",
      status: "AVVIK",
      comment: "Kommentar",
      answers: { f1: "svar" },
    });
  });

  it("avviser kladder uten brukbar state", () => {
    expect(
      restoreLocalDraft({
        requiresUnits: true,
        snapshot: {} as never,
      }),
    ).toBeNull();
  });
});
