"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiErrorMessage } from "@/lib/api-error-message";

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
  purpose = "branding",
  customerId,
}: {
  initialUrl?: string | null;
  name?: string;
  /** `branding` for global logo, `branding` med customerId for kundelogo. */
  purpose?: "branding" | "customer-logo";
  customerId?: string;
}) {
  const t = useTranslations("common");
  const [url, setUrl] = useState(initialUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("purpose", purpose);
      if (customerId) body.append("customerId", customerId);
      const response = await fetch("/api/upload", { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.fileUrl) {
        throw new Error(
          apiErrorMessage(
            data,
            t,
            t("components.brandingLogo.uploadFailed"),
          ),
        );
      }
      setUrl(data.fileUrl);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : t("components.brandingLogo.uploadFailed"),
      );
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
            alt={t("components.brandingLogo.alt")}
            className="h-12 w-auto rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-1"
          />
        ) : (
          <span className="text-sm text-[var(--muted,#62685f)]">{t("components.brandingLogo.none")}</span>
        )}
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-4 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]">
          {busy
            ? t("components.brandingLogo.uploading")
            : url
              ? t("components.brandingLogo.change")
              : t("components.brandingLogo.upload")}
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
            className="min-h-11 text-sm text-[var(--muted,#62685f)] underline-offset-2 transition hover:text-[var(--risk-text,#b42318)] hover:underline"
          >
            {t("components.brandingLogo.remove")}
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--muted,#62685f)]">
        {t("components.brandingLogo.help")}
      </p>
      {error && <p className="text-sm font-bold text-[var(--risk-text,#b42318)]">{error}</p>}
    </div>
  );
}
