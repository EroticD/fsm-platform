"use client";

import { useState } from "react";
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
 */
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
  const [urls, setUrls] = useState<string[]>(initialUrls);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");

  const uploadOne = async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    if (workOrderId) body.append("workOrderId", workOrderId);
    const res = await fetch("/api/upload", { method: "POST", body });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.fileUrl) {
      throw new Error(json.error || t("orders.imageUpload.uploadFailedOne", { name: file.name }));
    }
    return json.fileUrl as string;
  };

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Tøm inputen med en gang, slik at man kan velge samme bilde på nytt senere.
    event.target.value = "";
    setError("");

    if (files.length === 0) return;

    setBusy(true);
    setProgress({ done: 0, total: files.length });

    const uploaded: string[] = [];
    const failed: string[] = [];

    // Last opp ett og ett: mobilbilder er store, og flere samtidige
    // opplastinger gjør at trege mobilnett bruker unødvendig lang tid.
    for (const [index, file] of files.entries()) {
      try {
        uploaded.push(await uploadOne(file));
      } catch {
        failed.push(file.name);
      }
      setProgress({ done: index + 1, total: files.length });
    }

    if (uploaded.length > 0) {
      setUrls((current) => [...current, ...uploaded]);
    }
    if (failed.length > 0) {
      setError(
        failed.length === 1
          ? t("orders.imageUpload.uploadFailedOne", { name: failed[0] })
          : t("orders.imageUpload.uploadFailedMany", { count: failed.length, names: failed.join(", ") }),
      );
    }

    setBusy(false);
    setProgress(null);
  };

  const removeUrl = (url: string) => {
    setError("");
    setUrls((current) => current.filter((u) => u !== url));
  };

  return (
    <div className="bg-blue-50 p-4 rounded-xl border-2 border-blue-200 space-y-3">
      <label className="block text-sm font-black text-gray-900">
        📷 {label} {required && urls.length === 0 && <span className="text-red-500">*</span>}
      </label>

      <input
        type="file"
        accept="image/*"
        multiple
        onChange={handleChange}
        // Når minst ett bilde er lastet opp er kravet oppfylt, og vi fjerner
        // required slik at man ikke må velge filene på nytt.
        required={required && urls.length === 0}
        className="w-full border-2 border-gray-300 p-3 rounded-xl text-sm text-gray-900 bg-white outline-none focus:border-blue-700"
      />

      <p className="text-[11px] text-gray-500">
        {t("orders.imageUpload.hint")}
      </p>

      {busy && (
        <p className="text-[11px] font-bold text-blue-700 animate-pulse">
          {progress
            ? t("orders.imageUpload.uploading", { done: progress.done + 1, total: progress.total })
            : t("orders.imageUpload.uploadingShort")}
        </p>
      )}

      {urls.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-green-700">
            {t("orders.imageUpload.uploaded", { count: urls.length })}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {urls.map((url, index) => (
              <div key={`${url}-${index}`} className="relative group border-2 border-gray-200 rounded-xl overflow-hidden bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={t("orders.imageUpload.attachmentAlt", { number: index + 1 })} className="w-full h-24 object-cover" />
                <div className="flex items-center justify-between gap-1 px-2 py-1">
                  <a href={url} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-blue-700 underline">
                    {t("orders.imageUpload.viewImage")}
                  </a>
                  <button
                    type="button"
                    onClick={() => removeUrl(url)}
                    className="text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 px-2 py-0.5 rounded border border-red-200 transition"
                  >
                    {t("orders.imageUpload.remove")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-[11px] font-bold text-red-600">❌ {error}</p>}

      {/* Verdien som sendes med skjemaet: en JSON-liste med URL-er. */}
      <input type="hidden" name={name} value={urls.length > 0 ? JSON.stringify(urls) : ""} />
    </div>
  );
}
