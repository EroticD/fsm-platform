"use client";

import { useState } from "react";

/**
 * Laster opp firmalogo til appens eget opplastingsvolum.
 *
 * Vi tar ikke lenger imot vilkårlige eksterne URL-er: en logo som peker på en
 * intern adresse (f.eks. 169.254.169.254) ville gjort PDF- og e-postgenerering
 * til en SSRF-vektor. Feltet lagrer en `/uploads/...`-sti i skjemaet.
 */
export default function BrandingLogoUpload({
  initialUrl,
  name = "logoUrl",
}: {
  initialUrl?: string | null;
  name?: string;
}) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("purpose", "branding");
      const response = await fetch("/api/upload", { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.fileUrl) {
        throw new Error(data.error || "Opplasting feilet");
      }
      setUrl(data.fileUrl);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Opplasting feilet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={url} />
      <div className="flex flex-wrap items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Firmalogo"
            className="h-12 w-auto rounded-lg border border-gray-200 bg-white p-1"
          />
        ) : (
          <span className="text-sm text-gray-500">Ingen logo lastet opp</span>
        )}
        <label className="cursor-pointer rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">
          {busy ? "Laster opp …" : url ? "Bytt logo" : "Last opp logo"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
        </label>
        {url && (
          <button
            type="button"
            onClick={() => setUrl("")}
            className="text-sm text-gray-500 hover:text-red-600"
          >
            Fjern
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500">
        PNG, JPG, WebP eller GIF. Logoen lagres i appen og brukes i PDF-er,
        e-post og header.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
