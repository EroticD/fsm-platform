"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import ScannerNotice from "@/components/scanner/ScannerNotice";
import { isDuplicateScan, normalizeScannedCode } from "@/lib/scan-code";

type ScannerState =
  | "idle"
  | "starting"
  | "scanning"
  | "unsupported"
  | "denied"
  | "unavailable"
  | "error";

type DetectedBarcode = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => BarcodeDetectorLike;

function barcodeDetector(): BarcodeDetectorConstructor | null {
  const ctor = (
    window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }
  ).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

function noticeForCameraError(error: unknown): {
  state: ScannerState;
  key: "scanner.denied" | "scanner.unavailable" | "scanner.error";
} {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { state: "denied", key: "scanner.denied" };
  }
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  ) {
    return { state: "unavailable", key: "scanner.unavailable" };
  }
  return { state: "error", key: "scanner.error" };
}

/**
 * Kameraskanner med BarcodeDetector og manuell inntasting som reserve.
 *
 * Kameraet startes bare etter et klikk, og alle feil (manglende støtte,
 * nektet tilgang, manglende kamera) gir en lesbar melding og et manuelt felt.
 * Den skannede koden sendes som en URL-parameter til serveren, som avgjør om
 * brukeren faktisk har tilgang til enheten eller oppdraget.
 */
export default function BarcodeScanner() {
  const t = useTranslations("common");
  const router = useRouter();
  const [state, setState] = useState<ScannerState>("idle");
  const [notice, setNotice] = useState("");
  const [manual, setManual] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
  const mountedRef = useRef(true);

  const releaseCamera = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseCamera();
    };
  }, [releaseCamera]);

  async function startCamera() {
    setNotice("");
    setState("starting");

    const Detector = barcodeDetector();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      setNotice(t("scanner.unsupported"));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (error) {
      const result = noticeForCameraError(error);
      setState(result.state);
      setNotice(t(result.key));
      return;
    }

    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) {
      releaseCamera();
      setState("error");
      setNotice(t("scanner.error"));
      return;
    }

    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay kan nektes selv etter et klikk. Brukeren ser da et stille
      // bilde, men manuell inntasting virker fortsatt.
    }
    setState("scanning");
    runningRef.current = true;

    let detector: BarcodeDetectorLike;
    try {
      detector = new Detector({
        formats: [
          "qr_code",
          "code_128",
          "code_39",
          "ean_13",
          "ean_8",
          "data_matrix",
          "pdf417",
        ],
      });
    } catch {
      // Eldre implementasjoner godtar ikke formatlisten.
      detector = new Detector();
    }

    const tick = async () => {
      if (!runningRef.current || !videoRef.current) return;
      try {
        const results = await detector.detect(videoRef.current);
        const raw = results.find((result) => result.rawValue)?.rawValue;
        const code = raw ? normalizeScannedCode(raw) : "";
        if (code) {
          if (isDuplicateScan(lastScanRef.current, code)) {
            setNotice(t("scanner.duplicate"));
          } else {
            lastScanRef.current = { code, at: Date.now() };
            releaseCamera();
            router.push(`/skann?kode=${encodeURIComponent(code)}`);
            return;
          }
        }
      } catch {
        // Enkelte bilder kan ikke dekodes. Fortsett å se etter neste bilde i
        // stedet for å stoppe kameraet.
        setNotice(t("scanner.error"));
      }
      timerRef.current = window.setTimeout(tick, 350);
    };
    timerRef.current = window.setTimeout(tick, 250);
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
    router.push(`/skann?kode=${encodeURIComponent(code)}`);
  }

  const cameraActive = state === "starting" || state === "scanning";

  return (
    <div className="space-y-4">
      <ScannerNotice
        kind={
          state === "starting" || state === "scanning"
            ? "info"
            : state === "idle"
              ? "info"
              : state
        }
      >
        {notice}
      </ScannerNotice>

      <div
        className={`relative overflow-hidden rounded-2xl border-2 border-[#2a3328] bg-black ${
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
        className="space-y-2"
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
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-[#2a3328] bg-field px-3 text-sm font-bold text-paper outline-none transition placeholder:text-paper/45 focus:border-signal"
          />
          <button
            type="submit"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-white/10 px-4 text-sm font-bold text-paper transition hover:bg-white/15"
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
