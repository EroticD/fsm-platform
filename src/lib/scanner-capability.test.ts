import { describe, expect, it, vi } from "vitest";
import {
  chooseScannerEngine,
  classifyCameraError,
  hasBarcodeDetector,
  isTransientDecodeError,
  loadZxingReader,
  scannerContextIssue,
  scannerNoticeKind,
  scannerNoticeKey,
} from "./scanner-capability";

const namedError = (name: string, message = "") =>
  Object.assign(new Error(message), { name });

describe("valg av skannemotor", () => {
  it("bruker BarcodeDetector når nettleseren har den", () => {
    class FakeBarcodeDetector {}
    expect(hasBarcodeDetector({ BarcodeDetector: FakeBarcodeDetector })).toBe(
      true,
    );
    expect(chooseScannerEngine(true)).toBe("barcode-detector");
  });

  it("faller tilbake til ZXing når BarcodeDetector mangler (iOS/Android)", () => {
    expect(hasBarcodeDetector({})).toBe(false);
    expect(hasBarcodeDetector({ BarcodeDetector: undefined })).toBe(false);
    expect(chooseScannerEngine(false)).toBe("zxing");
  });

  it("laster ZXing-reserven dynamisk med QR-dekoding", async () => {
    vi.resetModules();
    vi.doMock("@zxing/browser", () => ({
      BrowserMultiFormatReader: class {
        decodeFromVideoElement = vi.fn();
      },
    }));
    const reader = await loadZxingReader();
    expect(typeof reader.decodeFromVideoElement).toBe("function");
    vi.doUnmock("@zxing/browser");
    vi.resetModules();
  });
});

describe("sikker kontekst og medie-API", () => {
  it("gir en egen HTTPS-feil i usikker kontekst", () => {
    expect(
      scannerContextIssue({
        isSecureContext: false,
        hasGetUserMedia: true,
      }),
    ).toBe("insecure");
  });

  it("behandler ukjent isSecureContext som trygt (eldre nettlesere)", () => {
    expect(
      scannerContextIssue({
        isSecureContext: undefined,
        hasGetUserMedia: true,
      }),
    ).toBe(null);
  });

  it("melder manglende getUserMedia som ikke støttet", () => {
    expect(
      scannerContextIssue({
        isSecureContext: true,
        hasGetUserMedia: false,
      }),
    ).toBe("unsupported");
  });
});

describe("klassifisering av kamerafeil", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["PermissionDeniedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "unavailable"],
    ["DevicesNotFoundError", "unavailable"],
    ["OverconstrainedError", "overconstrained"],
    ["ConstraintNotSatisfiedError", "overconstrained"],
    ["NotReadableError", "busy"],
    ["TrackStartError", "busy"],
    ["AbortError", "busy"],
  ])("oversetter %s til %s", (name, expected) => {
    expect(classifyCameraError(namedError(name))).toBe(expected);
  });

  it("kjenner igjen TypeError fra manglende mediaDevices", () => {
    expect(
      classifyCameraError(
        new TypeError("Cannot read properties of undefined (mediaDevices)"),
      ),
    ).toBe("unsupported");
  });

  it("gir en generell feil for ukjente feil", () => {
    expect(classifyCameraError(new Error("noe rart"))).toBe("error");
    expect(classifyCameraError(null)).toBe("error");
  });
});

describe("meldingsnøkler og presentasjon", () => {
  it("gir hver feiltilstand sin egen melding", () => {
    expect(scannerNoticeKey("insecure")).toBe("scanner.insecure");
    expect(scannerNoticeKey("denied")).toBe("scanner.denied");
    expect(scannerNoticeKey("unavailable")).toBe("scanner.unavailable");
    expect(scannerNoticeKey("overconstrained")).toBe("scanner.overconstrained");
    expect(scannerNoticeKey("busy")).toBe("scanner.busy");
    expect(scannerNoticeKey("decode")).toBe("scanner.decode");
    expect(scannerNoticeKey("loader-error")).toBe("scanner.loaderError");
    expect(scannerNoticeKey("unsupported")).toBe("scanner.unsupported");
  });

  it("viser ikke feilmelding mens kameraet er aktivt", () => {
    expect(scannerNoticeKey("starting")).toBe(null);
    expect(scannerNoticeKey("scanning")).toBe(null);
    expect(scannerNoticeKey("idle")).toBe(null);
    expect(scannerNoticeKind("starting")).toBe("info");
    expect(scannerNoticeKind("scanning")).toBe("info");
    expect(scannerNoticeKind("insecure")).toBe("insecure");
  });
});

describe("dekodefeil", () => {
  it("ignorerer «ingen kode i bildet» fra ZXing", () => {
    expect(isTransientDecodeError(namedError("NotFoundException"))).toBe(true);
    expect(isTransientDecodeError(namedError("ChecksumException"))).toBe(true);
    expect(isTransientDecodeError(namedError("FormatException"))).toBe(true);
  });

  it("rapporterer uventede dekodefeil", () => {
    expect(isTransientDecodeError(namedError("IllegalStateException"))).toBe(
      false,
    );
    expect(isTransientDecodeError(undefined)).toBe(false);
  });
});
