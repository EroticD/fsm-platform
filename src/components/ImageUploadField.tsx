"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

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
}: {
  name: string;
  label: string;
  required?: boolean;
  /** Bilder som allerede ligger på rapporten (ved redigering av en opplåst rapport). */
  initialUrls?: string[];
  /** Knytter bildene til oppdraget, slik at /uploads kan kreve riktig tilgang. */
  workOrderId?: string;
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

  // Opplastingene kjøres sekvensielt. Mobilbilder er store, og flere samtidige
  // opplastinger gjør at trege mobilnett bruker unødvendig lang tid.
  const uploadChain = useRef<Promise<void>>(Promise.resolve());
  const lastIncomingKey = useRef(initialUrls.filter(Boolean).join("\u0000"));

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
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
        json.error || t("orders.imageUpload.uploadFailedOne", { name: file.name }),
      );
    }
    return json.fileUrl as string;
  };

  const uploadItem = async (item: UploadItem) => {
    if (!item.file) return;
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
    } catch {
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: "error",
                error: t("orders.imageUpload.uploadFailedOne", {
                  name: item.name,
                }),
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
    const failed = items.filter((item) => item.status === "error" && item.file);
    for (const item of failed) retry(item);
  };

  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const doneUrls = items.flatMap((item) =>
    item.status === "done" && item.url ? [item.url] : [],
  );
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
        return item.error || t("orders.imageUpload.uploadFailedOne", { name: item.name });
      default:
        return "✅";
    }
  };
  const statusClass = (item: UploadItem) =>
    item.status === "error"
      ? "text-red-700"
      : item.status === "done"
        ? "text-green-700"
        : item.status === "uploading"
          ? "text-blue-700"
          : "text-gray-600";

  return (
    <div className="space-y-3 rounded-xl border-2 border-blue-200 bg-blue-50 p-4">
      <p className="block text-sm font-black text-gray-900">
        📷 {label}{" "}
        {required && doneUrls.length === 0 && (
          <span className="text-red-600">*</span>
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        <label
          htmlFor={cameraId}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-blue-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800"
        >
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
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border-2 border-blue-300 bg-white px-4 text-sm font-bold text-blue-800 shadow-sm transition hover:bg-blue-100"
        >
          {t("orders.imageUpload.choosePhoto")}
        </label>
        <input
          id={galleryId}
          type="file"
          accept="image/*"
          multiple
          required={required && doneUrls.length === 0}
          aria-describedby={`${hintId}${failedCount > 0 ? ` ${errorId}` : ""}`}
          aria-invalid={failedCount > 0 ? true : undefined}
          onChange={handleInputChange}
          className="sr-only"
        />
      </div>

      <p id={hintId} className="text-xs text-gray-600">
        {t("orders.imageUpload.hint")}
      </p>
      <p className="text-xs font-bold text-gray-700">
        {t("orders.imageUpload.networkRequired")}
      </p>

      {!online && (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900"
        >
          ⚠️ {t("orders.imageUpload.offline")}
        </p>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {doneUrls.length > 0 && (
              <p className="text-xs font-bold text-green-700">
                {t("orders.imageUpload.uploaded", { count: doneUrls.length })}
              </p>
            )}
            {failedCount > 0 && (
              <button
                type="button"
                onClick={retryAll}
                className="inline-flex min-h-11 items-center rounded-lg border border-red-300 bg-red-50 px-3 text-xs font-bold text-red-700 transition hover:bg-red-100"
              >
                ↻ {t("orders.imageUpload.retryAll")}
              </button>
            )}
          </div>

          <ul className="space-y-2">
            {items.map((item, index) => (
              <li
                key={item.id}
                className={`flex items-center gap-2 rounded-xl border bg-white p-2 ${
                  item.status === "error"
                    ? "border-red-300"
                    : "border-gray-200"
                }`}
              >
                {item.status === "done" && item.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.url}
                    alt={t("orders.imageUpload.attachmentAlt", {
                      number: index + 1,
                    })}
                    className="h-12 w-12 shrink-0 rounded-lg border border-gray-200 object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-lg"
                  >
                    {item.status === "error" ? "⚠️" : "📷"}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-gray-900">
                    {item.name}
                  </p>
                  <p
                    className={`text-xs font-bold ${statusClass(item)}`}
                    role={item.status === "error" ? "alert" : undefined}
                  >
                    {statusText(item)}
                  </p>
                </div>

                {item.status === "done" && item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-xs font-bold text-blue-700 underline"
                  >
                    {t("orders.imageUpload.viewImage")}
                  </a>
                )}

                {item.status === "error" && (
                  <button
                    type="button"
                    onClick={() => retry(item)}
                    className="inline-flex min-h-11 items-center rounded-lg border border-blue-300 bg-blue-50 px-2 text-xs font-bold text-blue-800 transition hover:bg-blue-100"
                  >
                    ↻ {t("orders.imageUpload.retry")}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  aria-label={t("orders.imageUpload.removeFile", {
                    name: item.name,
                  })}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-2 text-sm font-bold text-red-700 transition hover:bg-red-100"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>

          {busy && (
            <p className="text-xs font-bold text-blue-700" aria-live="polite">
              {t("orders.imageUpload.uploadingShort")}
            </p>
          )}

          {failedCount > 0 && (
            <p id={errorId} role="alert" className="text-xs font-bold text-red-700">
              ❌{" "}
              {t("orders.imageUpload.uploadFailedMany", {
                count: failedCount,
                names: items
                  .filter((item) => item.status === "error")
                  .map((item) => item.name)
                  .join(", "),
              })}
            </p>
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
