import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Merkevaretilpasset 404-side. Den ligger i app-roten, så både innloggede og
 * utloggede får en forklaring på norsk/engelsk i stedet for Next.js' standard
 * engelske «This page could not be found». Fargen kommer fra den samme
 * CSS-variabelen som resten av appen bruker.
 */
export default async function NotFound() {
  const t = await getTranslations("common");
  const companyName = "FSM";
  const initial = companyName.charAt(0).toUpperCase();

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-sm"
          style={{ backgroundColor: "var(--primary-color)" }}
          aria-hidden="true"
        >
          {initial}
        </div>
        <p className="text-sm font-black uppercase tracking-wider text-gray-500">
          404
        </p>
        <h1 className="mt-1 text-2xl font-black text-gray-900">
          {t("notFound.title")}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {t("notFound.description", { companyName })}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--primary-color)] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {t("notFound.home")}
          </Link>
          <Link
            href="/oppdrag"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            {t("notFound.workOrders")}
          </Link>
        </div>
      </div>
    </div>
  );
}
