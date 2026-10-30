"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiErrorMessage } from "@/lib/api-error-message";
import Icon from "@/components/icons";

/**
 * Bildefelt for rapport-skjemaet.
 *
 * Man kan velge flere bilder i én og samme opplasting. Hvert bilde lastes opp
 * til /api/upload med en gang det velges, og de ferdige fil-URLene sendes med
 * skjemaet i et skjult felt (som en JSON-liste). Da slipper server action-en å
 * håndtere filer, og rapporten lagrer bare små tekstverdier (URL-er).
 *
 * Eldre rapporter har én enkelt URL som ren tekst. Leserne godtar begge deler
 * (se src/lib/report-answers.ts).
 *
 * Viktig for kladdene: det skjulte feltet inneholder alltid de opplastede
 * URL-ene. Rapportskjemaet snapshooter hele FormData (se ReportForm), så
 * bildene følger med i både lokal og serverlagret kladd uten egne felter.
 */

type UploadStatus = "pending" | "uploading" | "done" | "error";

type UploadItem = {
  id: string;
  name: string;
  /** Finnes bare for filer som ennå ikke er lastet opp. */
  file?: File;
  status: UploadStatus;
  url?: string;
  error?: string;
};

/** Mobilbilder er store; 1600 px er rikelig for servicebilder. */
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
/** Små filer komprimeres ikke – da er vinningen minimal. */
const COMPRESS_THRESHOLD = 600 * 1024;

function itemId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Krymper et bilde i nettleseren før opplasting. Feiler komprimeringen (f.eks.
 * for HEIC i en nettleser som ikke kan dekode det), sendes originalfilen.
 */
async function compressImage(file: File): Promise<File> {
  if (
    !file.type.startsWith("image/") ||
    file.type === "image/gif" ||
    file.type === "image/svg+xml" ||
    file.size < COMPRESS_THRESHOLD ||
    typeof createImageBitmap !== "function"
  ) {
    return file;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    // Allerede lite nok – unngå unødvendig omkoding.
    if (scale === 1 && file.size < 1.2 * 1024 * 1024) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;

    // Hvit bakgrunn, slik at gjennomsiktige PNG-er ikke blir svarte i JPEG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    if (!blob) return file;

    const name = `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
    return new File([blob], name, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}

export default function ImageUploadField({
  name,
  label,
  required,
  initialUrls = [],
  workOrderId,
  onCountChange,
}: {
  name: string;
  label: string;
  required?: boolean;
  /** Bilder som allerede ligger på rapporten (ved redigering av en opplåst rapport). */
  initialUrls?: string[];
  /** Knytter bildene til oppdraget, slik at /uploads kan kreve riktig tilgang. */
  workOrderId?: string;
  /** Antall ferdig opplastede bilder, slik at stegstripen kan telle dem. */
  onCountChange?: (count: number) => void;
}) {
  const t = useTranslations("common");
  const fieldId = useId();
  const cameraId = `${fieldId}-camera`;
  const galleryId = `${fieldId}-gallery`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  const [items, setItems] = useState<UploadItem[]>(() =>
    initialUrls.filter(Boolean).map((url, index) => ({
      id: `initial-${index}-${url}`,
      name: url.split("/").pop() || url,
      status: "done" as const,
      url,
    })),
  );
  const [online, setOnline] = useState(true);
  const itemsRef = useRef(items);
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Opplastingene kjøres sekvensielt. Mobilbilder er store, og flere samtidige
  // opplastinger gjør at trege mobilnett bruker unødvendig lang tid.
  const uploadChain = useRef<Promise<void>>(Promise.resolve());
  const lastIncomingKey = useRef(initialUrls.filter(Boolean).join("\u0000"));

  useEffect(() => {
    const update = () => {
      const next = navigator.onLine;
      setOnline(next);
      if (!next) wasOfflineRef.current = true;
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // En gjenopprettet kladd kan gi feltet nye URL-er etter at det er montert.
  // Da legger vi dem til uten å fjerne bilder brukeren nettopp har valgt.
  const incomingKey = initialUrls.filter(Boolean).join("\u0000");
  useEffect(() => {
    if (incomingKey === lastIncomingKey.current) return;
    lastIncomingKey.current = incomingKey;

    setItems((current) => {
      const known = new Set(
        current.flatMap((item) => (item.url ? [item.url] : [])),
      );
      const additions: UploadItem[] = initialUrls
        .filter((url) => url && !known.has(url))
        .map((url, index) => ({
          id: `incoming-${Date.now()}-${index}-${url}`,
          name: url.split("/").pop() || url,
          status: "done" as const,
          url,
        }));
      return additions.length > 0 ? [...current, ...additions] : current;
    });
  }, [incomingKey, initialUrls]);

  const uploadOne = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    if (workOrderId) body.append("workOrderId", workOrderId);
    const res = await fetch("/api/upload", { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.fileUrl) {
      throw new Error(
        apiErrorMessage(
          json,
          t,
          t("orders.imageUpload.uploadFailedOne", { name: file.name }),
        ),
      );
    }
    return json.fileUrl as string;
  };

  const uploadItem = async (item: UploadItem) => {
    if (!item.file) return;

    // Offline skal ikke gi en rød feil: filen ligger klart i køen og lastes
    // opp automatisk når nettleseren melder at nettet er tilbake.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: "pending", error: undefined }
            : entry,
        ),
      );
      wasOfflineRef.current = true;
      return;
    }

    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, status: "uploading", error: undefined }
          : entry,
      ),
    );

    try {
      const prepared = await compressImage(item.file);
      const url = await uploadOne(prepared);
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, status: "done", url, file: undefined, error: undefined }
            : entry,
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t("orders.imageUpload.uploadFailedOne", { name: item.name });
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: "error",
                error: message,
              }
            : entry,
        ),
      );
    }
  };

  const processItems = async (queue: UploadItem[]) => {
    for (const item of queue) {
      await uploadItem(item);
    }
  };

  const enqueue = (queue: UploadItem[]) => {
    if (queue.length === 0) return;
    setItems((current) => [...current, ...queue]);
    uploadChain.current = uploadChain.current.then(() => processItems(queue));
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Tøm inputen med en gang, slik at man kan velge samme bilde på nytt senere.
    event.target.value = "";
    if (files.length === 0) return;

    enqueue(
      files.map((file) => ({
        id: itemId(),
        name: file.name,
        file,
        status: "pending" as const,
      })),
    );
  };

  const retry = (item: UploadItem) => {
    if (!item.file) return;
    uploadChain.current = uploadChain.current.then(() => uploadItem(item));
  };

  const retryAll = () => {
    const failed = items.filter(
      (item) =>
        (item.status === "error" || item.status === "pending") && item.file,
    );
    for (const item of failed) retry(item);
  };

  // Når nettet kommer tilbake, prøver vi køen automatisk. Montøren slipper å
  // trykke «prøv igjen» for hver fil som ventet på dekning.
  const retryRef = useRef(retry);
  useEffect(() => {
    // Hold siste retry-funksjon tilgjengelig for online-effekten uten å
    // registrere nettleserlytteren på nytt for hver rendering.
    retryRef.current = retry;
  });
  useEffect(() => {
    if (!online || !wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    const queue = itemsRef.current.filter(
      (item) =>
        (item.status === "error" || item.status === "pending") && item.file,
    );
    for (const item of queue) retryRef.current(item);
  }, [online]);

  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const doneUrls = items.flatMap((item) =>
    item.status === "done" && item.url ? [item.url] : [],
  );
  useEffect(() => {
    onCountChange?.(doneUrls.length);
  }, [doneUrls.length, onCountChange]);
  const failedCount = items.filter((item) => item.status === "error").length;
  const busy = items.some(
    (item) => item.status === "pending" || item.status === "uploading",
  );
  const statusText = (item: UploadItem) => {
    switch (item.status) {
      case "pending":
        return t("orders.imageUpload.pendingFile");
      case "uploading":
        return t("orders.imageUpload.uploadingFile");
      case "error":
        // Selve feilårsaken vises under filnavnet, slik at montøren ser hva
        // som faktisk feilet og kan prøve den enkelte filen på nytt.
        return t("orders.imageUpload.failedShort");
      default:
        return "";
    }
  };
  const statusClass = (item: UploadItem) =>
    item.status === "error"
      ? "text-risk"
      : item.status === "done"
        ? "text-success"
        : item.status === "uploading"
          ? "text-success"
          : "text-muted";

  return (
    <div className="field-card space-y-3 p-4">
      <p className="flex items-center gap-2 text-sm font-black text-paper">
        <Icon name="camera" className="h-4 w-4 shrink-0 text-signal" />
        {label}{" "}
        {required && doneUrls.length === 0 && (
          <span className="text-risk">*</span>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <label
          htmlFor={cameraId}
          className="signal-button cursor-pointer gap-2 text-sm shadow-sm"
        >
          <Icon name="camera" className="h-4 w-4" />
          {t("orders.imageUpload.takePhoto")}
        </label>
        <input
          id={cameraId}
          type="file"
          accept="image/*"
          capture="environment"
          aria-describedby={hintId}
          onChange={handleInputChange}
          className="sr-only"
        />

        <label
          htmlFor={galleryId}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#2a3328] bg-white/5 px-4 text-sm font-bold text-paper shadow-sm transition hover:border-signal/60 hover:bg-white/10"
        >
          <Icon name="image" className="h-4 w-4" />
          {t("orders.imageUpload.choosePhoto")}
        </label>
        <input
          id={galleryId}
          type="file"
          accept="image/*"
          multiple
          // Kamera og galleri er to veier til samme bildefelt. HTML `required`
          // på bare galleri ville blokkert innsending når montøren tok bildet
          // med kameraet. Serveren håndhever det påkrevde feltet i stedet.
          aria-required={required && doneUrls.length === 0}
          aria-describedby={`${hintId}${failedCount > 0 ? ` ${errorId}` : ""}`}
          aria-invalid={failedCount > 0 ? true : undefined}
          onChange={handleInputChange}
          className="sr-only"
        />
      </div>

      <p id={hintId} className="text-xs text-paper/70">
        {t("orders.imageUpload.hint")}
      </p>
      <p className="text-xs font-bold text-paper/90">
        {t("orders.imageUpload.networkRequired")}
      </p>

      {!online && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-signal/40 bg-signal/10 px-3 py-2 text-xs font-bold text-signal"
        >
          <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("orders.imageUpload.offline")}
        </p>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {doneUrls.length > 0 && (
            <p className="text-xs font-bold text-signal">
              {t("orders.imageUpload.uploaded", { count: doneUrls.length })}
            </p>
          )}

          <ul className="space-y-2">
            {items.map((item, index) => (
              <li
                key={item.id}
                className={`flex flex-col gap-2 rounded-xl border bg-paper p-2.5 text-ink sm:flex-row sm:items-center ${
                  item.status === "error"
                    ? "border-risk/30"
                    : "border-line"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  {item.status === "done" && item.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.url}
                      alt={t("orders.imageUpload.attachmentAlt", {
                        number: index + 1,
                      })}
                      className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/50"
                    >
                      <Icon
                        name={item.status === "error" ? "alert" : "camera"}
                        className={`h-5 w-5 ${
                          item.status === "error" ? "text-risk" : "text-muted"
                        }`}
                      />
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="break-words text-xs font-bold text-ink">
                      {item.name}
                    </p>
                    <p
                      className={`flex items-center gap-1.5 text-xs font-bold ${statusClass(item)}`}
                    >
                      {item.status === "done" && (
                        <Icon name="check" className="h-3.5 w-3.5" />
                      )}
                      {item.status === "uploading" && (
                        <Icon name="sync" className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {item.status === "pending" && (
                        <Icon name="clock" className="h-3.5 w-3.5" />
                      )}
                      {item.status === "error" && (
                        <Icon name="alert" className="h-3.5 w-3.5" />
                      )}
                      {statusText(item)}
                      {item.status === "done" && (
                        <span className="sr-only">
                          {t("orders.imageUpload.uploaded", { count: 1 })}
                        </span>
                      )}
                    </p>
                    {item.status === "error" && item.error && (
                      <p className="mt-0.5 break-words text-[11px] font-bold text-risk">
                        {item.error}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0">
                  {item.status === "done" && item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold text-success underline"
                    >
                      <Icon name="image" className="h-3.5 w-3.5" />
                      {t("orders.imageUpload.viewImage")}
                    </a>
                  )}

                  {(item.status === "error" || item.status === "pending") &&
                    item.file && (
                      <button
                        type="button"
                        onClick={() => retry(item)}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-signal/40 bg-signal/10 px-3 text-xs font-bold text-signal transition hover:bg-signal/15"
                      >
                        <Icon name="sync" className="h-3.5 w-3.5" />
                        {t("orders.imageUpload.retry")}
                      </button>
                    )}

                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    aria-label={t("orders.imageUpload.removeFile", {
                      name: item.name,
                    })}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-risk/30 bg-risk/10 px-2 text-sm font-bold text-risk transition hover:bg-risk/15"
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {busy && (
            <p
              className="flex items-center gap-1.5 text-xs font-bold text-signal"
              aria-live="polite"
            >
              <Icon name="sync" className="h-3.5 w-3.5 animate-spin" />
              {t("orders.imageUpload.uploadingShort")}
            </p>
          )}

          {failedCount > 0 && (
            <div
              id={errorId}
              role="alert"
              className="flex flex-col gap-2 rounded-xl border border-risk/50 bg-risk/10 p-3 text-xs font-bold text-risk sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="flex min-w-0 items-start gap-1.5 break-words">
                <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("orders.imageUpload.uploadFailedMany", {
                  count: failedCount,
                  names: items
                    .filter((item) => item.status === "error")
                    .map((item) => item.name)
                    .join(", "),
                })}
              </p>
              <button
                type="button"
                onClick={retryAll}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-risk/50 bg-paper px-3 text-xs font-bold text-risk transition hover:bg-risk/15"
              >
                <Icon name="sync" className="h-3.5 w-3.5" />
                {t("orders.imageUpload.retryAll")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Verdien som sendes med skjemaet: en JSON-liste med URL-er. */}
      <input
        type="hidden"
        name={name}
        value={doneUrls.length > 0 ? JSON.stringify(doneUrls) : ""}
      />
    </div>
  );
}
