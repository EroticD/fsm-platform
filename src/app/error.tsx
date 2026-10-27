"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
}) {
  const t = useTranslations("common");

  useEffect(() => {
    // Vis aldri tekniske feilmeldinger til brukeren. Logg dem i stedet, slik
    // at de kan feilsøkes uten å lekke detaljer i grensesnittet.
    console.error("Ubehandlet sidefeil:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200 text-center max-w-md w-full">
        <p className="text-4xl mb-3" aria-hidden="true">⚠️</p>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {t("components.error.title")}
        </h2>
        <p className="text-gray-600 mb-6">{t("components.error.description")}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => (reset ? reset() : window.location.reload())}
            className="min-h-11 rounded-xl bg-blue-700 px-4 py-2.5 font-bold text-white hover:bg-blue-800 transition"
          >
            {t("components.error.retry")}
          </button>
          <Link
            href="/"
            className="min-h-11 rounded-xl border border-gray-300 bg-white px-4 py-2.5 font-bold text-gray-800 hover:bg-gray-50 transition"
          >
            {t("components.error.home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
