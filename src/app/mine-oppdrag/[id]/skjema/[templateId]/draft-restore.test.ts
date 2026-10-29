import { describe, expect, it } from "vitest";
import {
  makeUnit,
  REPORT_WITHOUT_UNITS_KEY,
  restoreLocalDraft,
  type LocalDraftSnapshot,
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

describe("makeUnit", () => {
  it("starter en ny enhet som ikke vurdert", () => {
    expect(makeUnit("unit-0").status).toBe("UNASSESSED");
    expect(makeUnit("unit-0", { status: undefined }).status).toBe("UNASSESSED");
  });

  it("beholder en eksplisitt vurdering fra kladden", () => {
    expect(makeUnit("unit-0", { status: "GODKJENT" }).status).toBe("GODKJENT");
    expect(makeUnit("unit-0", { status: "AVVIK" }).status).toBe("AVVIK");
  });
});

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

  it("gjenoppretter bilde-svar og kommentarer fra skjemaet", () => {
    const restored = restoreLocalDraft({
      requiresUnits: true,
      fallback: seed(),
      snapshot: {
        state: {
          counter: 1,
          units: [
            {
              key: "unit-0",
              productId: "prod1",
              label: "Port Nord",
              serialNumber: "SN-1",
              location: "Bygg A",
              status: "AVVIK",
              // Kommentaren i state kan være eldre enn skjemaet.
              comment: "gammel kommentar",
              answers: { f1: "Avvik" },
            },
          ],
        },
        form: {
          "answer__unit-0__f1": "Avvik",
          "answer__unit-0__f_image":
            '["/uploads/bilde-1.png","/uploads/bilde-2.png"]',
          "linecomment__unit-0__f1": "Kommentar til avviket",
          "comment__unit-0": "Ny enhetskommentar",
        },
      },
    });

    expect(restored).not.toBeNull();
    expect(restored?.state.units[0].answers).toMatchObject({
      f1: "Avvik",
      f_image: '["/uploads/bilde-1.png","/uploads/bilde-2.png"]',
      "f1__kommentar": "Kommentar til avviket",
    });
    expect(restored?.state.units[0].comment).toBe("Ny enhetskommentar");
    // Startobjektet brukes til å rendre feltene på nytt, og må ha samme verdier.
    expect(restored?.seed.units[0]).toMatchObject({
      comment: "Ny enhetskommentar",
      answers: {
        f_image: '["/uploads/bilde-1.png","/uploads/bilde-2.png"]',
        "f1__kommentar": "Kommentar til avviket",
      },
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

  it("gjenoppretter godkjent status fra en eldre kladd", () => {
    const restored = restoreLocalDraft({
      requiresUnits: true,
      fallback: seed(),
      snapshot: {
        state: {
          counter: 1,
          units: [
            {
              key: "unit-0",
              productId: "",
              label: "Pumpe",
              serialNumber: "",
              location: "",
              status: "GODKJENT",
              comment: "",
              answers: {},
            },
          ],
        },
      },
    });

    expect(restored?.state.units[0].status).toBe("GODKJENT");
    expect(restored?.seed.units[0].status).toBe("GODKJENT");
  });

  it("gjenoppretter en eldre kladd uten status som ikke vurdert", () => {
    const restored = restoreLocalDraft({
      requiresUnits: true,
      fallback: seed(),
      snapshot: {
        state: {
          counter: 1,
          units: [
            {
              key: "unit-0",
              productId: "",
              label: "Pumpe",
              serialNumber: "",
              location: "",
              // Eldre kladd skrevet før enheter fikk en vurdering.
              comment: "",
              answers: {},
            },
          ],
        },
      } as unknown as LocalDraftSnapshot,
    });

    expect(restored?.state.units[0].status).toBe("UNASSESSED");
    expect(restored?.seed.units[0].status).toBe("UNASSESSED");
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
