"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import ScannerNotice from "@/components/scanner/ScannerNotice";
import { isDuplicateScan, normalizeScannedCode } from "@/lib/scan-code";
import {
  chooseScannerEngine,
  classifyCameraError,
  hasBarcodeDetector,
  isTransientDecodeError,
  loadZxingReader,
  scannerContextIssue,
  scannerNoticeKey,
  scannerNoticeKind,
  type ScannerState,
  type ZxingControls,
} from "@/lib/scanner-capability";

type DetectedBarcode = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

const NATIVE_FORMATS = [
  "qr_code",
  "code_128",
  "code_39",
  "ean_13",
  "ean_8",
  "data_matrix",
  "pdf417",
];

function barcodeDetector(): BarcodeDetectorConstructor | null {
  if (typeof window === "undefined") return null;
  const ctor = (
    window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }
  ).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

/**
 * Kameraskanner med BarcodeDetector der den finnes, ZXing som reserve, og
 * manuell inntasting som siste utvei.
 *
 * Kameraet startes bare etter et klikk. BarcodeDetector mangler i iOS Safari og
 * i flere Android-nettlesere, så reserven lastes dynamisk først når den trengs.
 * Alle feil (usikker kontekst, nektet tilgang, manglende kamera, opptatt
 * kamera) gir en egen lesbar melding og et manuelt felt. Den skannede koden
 * sendes som en URL-parameter til serveren, som avgjør om brukeren faktisk har
 * tilgang til enheten eller oppdraget.
 */
export default function BarcodeScanner({
  onDetected,
  autoStart = false,
  showManual = true,
}: {
  /** Når satt, fylles verdien inn i skjemaet i stedet for å navigere. */
  onDetected?: (code: string) => void;
  /** Starter kameraet automatisk når komponenten vises. */
  autoStart?: boolean;
  /** Skjuler det innebygde manuelle feltet når vertsskjemaet har eget felt. */
  showManual?: boolean;
} = {}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [state, setState] = useState<ScannerState>("idle");
  const [notice, setNotice] = useState("");
  const [manual, setManual] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<ZxingControls | null>(null);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  // Øker hver gang kameraet startes eller stoppes, slik at et sent svar fra
  // getUserMedia/dynamisk import ikke får starte et kamera brukeren har lukket.
  const runRef = useRef(0);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const mountedRef = useRef(true);
  const autoStartedRef = useRef(false);

  const releaseCamera = useCallback(() => {
    runningRef.current = false;
    runRef.current += 1;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const controls = controlsRef.current;
    controlsRef.current = null;
    try {
      controls?.stop();
    } catch {
      // ZXing kan allerede ha stoppet etter en dekodefeil.
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopCamera = useCallback(() => {
    releaseCamera();
    setState("idle");
    setNotice("");
  }, [releaseCamera]);

  const handleCode = useCallback(
    (code: string) => {
      releaseCamera();
      if (onDetected) {
        onDetected(code);
        return;
      }
      router.push(`/skann?kode=${encodeURIComponent(code)}`);
    },
    [onDetected, releaseCamera, router],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseCamera();
    };
  }, [releaseCamera]);

  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void startCamera();
    // startCamera er en stabil klikkhandler; vi vil bare starte én gang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  async function openCameraStream(): Promise<MediaStream> {
    const media = navigator.mediaDevices;
    try {
      // `ideal` gir bakhjulskamera der det finnes, men tvinger ikke frem en
      // feil på enheter som bare har frontkamera.
      return await media.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (error) {
      if (classifyCameraError(error) !== "overconstrained") throw error;
      // Eldre nettlesere kan avvise facingMode selv om et kamera finnes.
      return media.getUserMedia({ video: true, audio: false });
    }
  }

  async function startCamera() {
    setNotice("");
    setState("starting");
    const run = ++runRef.current;

    const issue = scannerContextIssue({
      isSecureContext: window.isSecureContext,
      hasGetUserMedia:
        typeof navigator.mediaDevices?.getUserMedia === "function",
    });
    if (issue) {
      setState(issue);
      setNotice(t(scannerNoticeKey(issue) ?? "scanner.error"));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await openCameraStream();
    } catch (error) {
      if (run !== runRef.current) return;
      const next = classifyCameraError(error);
      setState(next);
      setNotice(t(scannerNoticeKey(next) ?? "scanner.error"));
      return;
    }

    if (!mountedRef.current || run !== runRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const video = videoRef.current;
    if (!video) {
      stream.getTracks().forEach((track) => track.stop());
      setState("error");
      setNotice(t("scanner.error"));
      return;
    }

    streamRef.current = stream;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay kan nektes selv etter et klikk. Brukeren ser da et stille
      // bilde, men manuell inntasting virker fortsatt.
    }

    if (run !== runRef.current) return;
    setState("scanning");
    runningRef.current = true;

    const Detector = barcodeDetector();
    const engine = chooseScannerEngine(
      hasBarcodeDetector(window as unknown as { BarcodeDetector?: unknown }),
    );

    if (engine === "barcode-detector" && Detector) {
      const started = startNativeDetector(Detector, video, run);
      if (started) return;
      // Konstruksjonen feilet. Prøv ZXing i stedet for å erklære manglende støtte.
    }
    await startZxing(video, run);
  }

  /**
   * Starter BarcodeDetector. Returnerer false når konstruksjonen feiler, slik
   * at kalleren kan falle tilbake til ZXing. Feiler `detect` gjentatte ganger,
   * byttes det også automatisk til ZXing.
   */
  function startNativeDetector(
    Detector: BarcodeDetectorConstructor,
    video: HTMLVideoElement,
    run: number,
  ): boolean {
    let detector: BarcodeDetectorLike;
    try {
      detector = new Detector({ formats: NATIVE_FORMATS });
    } catch {
      try {
        // Eldre implementasjoner godtar ikke formatlisten.
        detector = new Detector();
      } catch {
        return false;
      }
    }

    let failures = 0;
    const tick = async () => {
      if (!runningRef.current || run !== runRef.current || !videoRef.current) {
        return;
      }
      try {
        const results = await detector.detect(videoRef.current);
        failures = 0;
        const raw = results.find((result) => result.rawValue)?.rawValue;
        const code = raw ? normalizeScannedCode(raw) : "";
        if (code) {
          if (isDuplicateScan(lastScanRef.current, code)) {
            setNotice(t("scanner.duplicate"));
          } else {
            lastScanRef.current = { code, at: Date.now() };
            handleCode(code);
            return;
          }
        }
      } catch {
        failures += 1;
        if (failures >= 3) {
          // BarcodeDetector finnes, men virker ikke i denne nettleseren.
          // Behold strømmen og fortsett med ZXing.
          runningRef.current = false;
          if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
          }
          runningRef.current = true;
          setState("scanning");
          void startZxing(videoRef.current, run);
          return;
        }
      }
      timerRef.current = window.setTimeout(tick, 350);
    };
    timerRef.current = window.setTimeout(tick, 250);
    return true;
  }

  /** Laster ZXing dynamisk og dekoder fra den allerede åpne kamera­strømmen. */
  async function startZxing(video: HTMLVideoElement, run: number) {
    let controls: ZxingControls;
    try {
      const reader = await loadZxingReader();
      if (!runningRef.current || run !== runRef.current) return;
      let decodeFailures = 0;
      controls = await reader.decodeFromVideoElement(
        video,
        (result, error) => {
          if (!runningRef.current || run !== runRef.current) return;
          if (result) {
            const code = normalizeScannedCode(result.getText());
            if (code) {
              if (isDuplicateScan(lastScanRef.current, code)) {
                setNotice(t("scanner.duplicate"));
              } else {
                lastScanRef.current = { code, at: Date.now() };
                handleCode(code);
              }
            }
            return;
          }
          if (error && !isTransientDecodeError(error)) {
            decodeFailures += 1;
            if (decodeFailures === 5) {
              // Kameraet virker, men bildet kan ikke dekodes. Fortsett likevel;
              // brukeren kan flytte seg eller bruke det manuelle feltet.
              setNotice(t("scanner.decode"));
            }
          }
        },
      );
    } catch {
      if (run !== runRef.current) return;
      releaseCamera();
      setState("loader-error");
      setNotice(t("scanner.loaderError"));
      return;
    }

    if (!runningRef.current || run !== runRef.current) {
      try {
        controls.stop();
      } catch {
        // Allerede stoppet.
      }
      return;
    }
    controlsRef.current = controls;
    setState("scanning");
  }

  function submitManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = normalizeScannedCode(manual);
    if (!code) {
      setState("error");
      setNotice(t("scanner.errors.invalid"));
      inputRef.current?.focus();
      return;
    }
    releaseCamera();
    handleCode(code);
  }

  const cameraActive = state === "starting" || state === "scanning";

  return (
    <div className="space-y-4">
      <ScannerNotice kind={scannerNoticeKind(state)}>{notice}</ScannerNotice>

      <div
        className={`relative overflow-hidden rounded-2xl border-2 border-[var(--field-line)] bg-black ${
          cameraActive ? "block" : "hidden"
        }`}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          aria-label={t("scanner.videoAria")}
          className="aspect-[4/3] w-full object-cover"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-6 rounded-xl border-2 border-signal/80"
        />
        <p className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-center text-xs font-bold text-paper">
          {state === "starting" ? t("scanner.starting") : t("scanner.scanning")}
        </p>
      </div>

      <button
        type="button"
        onClick={cameraActive ? stopCamera : startCamera}
        disabled={state === "starting"}
        className="signal-button w-full justify-center gap-2 text-sm disabled:opacity-60"
      >
        <Icon name={cameraActive ? "close" : "camera"} className="h-4 w-4" />
        {state === "starting"
          ? t("scanner.starting")
          : cameraActive
            ? t("scanner.stop")
            : t("scanner.start")}
      </button>

      <form
        action="/skann"
        method="get"
        onSubmit={submitManual}
        className={showManual ? "space-y-2" : "hidden"}
      >
        <label
          htmlFor="scan-manual"
          className="block text-xs font-black uppercase tracking-[0.14em] text-paper/70"
        >
          {t("scanner.manualLabel")}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            id="scan-manual"
            name="kode"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder={t("scanner.manualPlaceholder")}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--field-line)] bg-field px-3 text-sm font-bold text-paper outline-none transition placeholder:text-paper/45 focus:border-signal"
          />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-surface/10 px-4 text-sm font-bold text-paper transition hover:bg-surface/15"
          >
            <Icon name="search" className="h-4 w-4" />
            {t("scanner.manualSubmit")}
          </button>
        </div>
        <p className="text-xs font-medium text-paper/55">{t("scanner.manualHint")}</p>
      </form>
    </div>
  );
}
