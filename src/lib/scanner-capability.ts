/**
 * Valg av skannemotor og oversetting av kamera-/dekodefeil.
 *
 * Logikken er skilt fra React-komponenten slik at den kan testes uten kamera.
 * `BarcodeDetector` er rask der den finnes, men mangler i iOS Safari og i flere
 * Android-nettlesere. Da brukes ZXing som reserve. Vi erklærer aldri
 * «ikke støttet» så lenge reserven er tilgjengelig.
 */

export type ScannerEngine = "barcode-detector" | "zxing";

/**
 * `BarcodeDetector` brukes når nettleseren har den, ellers ZXing. Reserven er
 * alltid tilgjengelig fordi den ligger i appens egen bundle (lastes dynamisk).
 */
export function chooseScannerEngine(hasBarcodeDetector: boolean): ScannerEngine {
  return hasBarcodeDetector ? "barcode-detector" : "zxing";
}

/** Sjekker om nettleseren eksponerer en brukbar BarcodeDetector-konstruktør. */
export function hasBarcodeDetector(scope: {
  BarcodeDetector?: unknown;
}): boolean {
  return typeof scope.BarcodeDetector === "function";
}

export type ZxingResult = { getText: () => string };
export type ZxingControls = { stop: () => void };
export type ZxingReader = {
  decodeFromVideoElement: (
    video: HTMLVideoElement,
    callback: (result?: ZxingResult, error?: unknown) => void,
  ) => Promise<ZxingControls>;
};

/**
 * Laster ZXing først når BarcodeDetector mangler eller feiler. Egen funksjon
 * gjør det mulig å teste reserven uten en nettleser.
 */
export async function loadZxingReader(): Promise<ZxingReader> {
  const { BrowserMultiFormatReader } = await import("@zxing/browser");
  return new BrowserMultiFormatReader(undefined, {
    delayBetweenScanAttempts: 250,
    delayBetweenScanSuccess: 800,
  }) as unknown as ZxingReader;
}

export type ScannerState =
  | "idle"
  | "starting"
  | "scanning"
  | "unsupported"
  | "insecure"
  | "denied"
  | "unavailable"
  | "overconstrained"
  | "busy"
  | "decode"
  | "loader-error"
  | "error";

export type ScannerNoticeKind =
  | "info"
  | "duplicate"
  | "unsupported"
  | "insecure"
  | "denied"
  | "unavailable"
  | "overconstrained"
  | "busy"
  | "decode"
  | "loader-error"
  | "error";

/**
 * Hindringer som må sjekkes før kameraet i det hele tatt åpnes.
 * `undefined` for `isSecureContext` behandles som «ukjent», ikke som usikkert,
 * fordi eldre nettlesere ikke eksponerer flagget.
 */
export function scannerContextIssue(input: {
  isSecureContext: boolean | undefined;
  hasGetUserMedia: boolean;
}): "insecure" | "unsupported" | null {
  if (input.isSecureContext === false) return "insecure";
  if (!input.hasGetUserMedia) return "unsupported";
  return null;
}

/**
 * Oversetter en feil fra getUserMedia til en egen tilstand. Nettleserne bruker
 * ulike navn på samme feil, derfor dekkes både standardnavn og eldre aliaser.
 */
export function classifyCameraError(error: unknown): ScannerState {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : "";

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "denied";
  }
  // SecurityError kan bety både blokkert opphav og usikker kontekst. Siden
  // sikker kontekst sjekkes først, behandles den her som nektet tilgang.
  if (name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "unavailable";
  }
  if (
    name === "OverconstrainedError" ||
    name === "ConstraintNotSatisfiedError"
  ) {
    return "overconstrained";
  }
  if (
    name === "NotReadableError" ||
    name === "TrackStartError" ||
    name === "AbortError"
  ) {
    return "busy";
  }
  // Nettlesere uten mediaDevices kaster TypeError før noe kamera er forsøkt.
  if (
    name === "TypeError" &&
    /mediaDevices|getUserMedia|undefined/i.test(message)
  ) {
    return "unsupported";
  }
  return "error";
}

/** i18n-nøkkel (under `common.`) for hver tilstand som viser en melding. */
export function scannerNoticeKey(
  state: ScannerState,
): `scanner.${string}` | null {
  switch (state) {
    case "unsupported":
      return "scanner.unsupported";
    case "insecure":
      return "scanner.insecure";
    case "denied":
      return "scanner.denied";
    case "unavailable":
      return "scanner.unavailable";
    case "overconstrained":
      return "scanner.overconstrained";
    case "busy":
      return "scanner.busy";
    case "decode":
      return "scanner.decode";
    case "loader-error":
      return "scanner.loaderError";
    case "error":
      return "scanner.error";
    default:
      return null;
  }
}

/** Presentasjonsvariant for ScannerNotice. */
export function scannerNoticeKind(state: ScannerState): ScannerNoticeKind {
  switch (state) {
    case "starting":
    case "scanning":
    case "idle":
      return "info";
    default:
      return state;
  }
}

/** Tilstander som skal varsles som feil (role="alert"). */
export function isScannerAlert(state: ScannerNoticeKind): boolean {
  return state !== "info" && state !== "duplicate";
}

/**
 * En dekodefeil er normalt bare «ingen kode i dette bildet» og skal ikke gi
 * støy. ZXing kaster NotFoundException hver gang den ikke ser en kode.
 */
export function isTransientDecodeError(error: unknown): boolean {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  return (
    name === "NotFoundException" ||
    name === "ChecksumException" ||
    name === "FormatException"
  );
}
