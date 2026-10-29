import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/Skeleton";

/** Skjelett for rapportviseren: mørk metadataheader og PDF-ramme under. */
export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-gray-100"
      role="status"
      aria-live="polite"
    >
      <div aria-hidden="true" className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-start justify-between gap-3 bg-gray-900 p-4 text-white shadow-md">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-5 w-56 max-w-full bg-gray-700" />
              <Skeleton className="h-5 w-20 rounded-full bg-gray-700" />
            </div>
            <Skeleton className="h-3 w-72 max-w-full bg-gray-700" />
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Skeleton className="h-5 w-20 rounded-full bg-gray-700" />
              <Skeleton className="h-5 w-28 rounded-full bg-gray-700" />
              <Skeleton className="h-5 w-24 rounded-full bg-gray-700" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 bg-gray-700" />
            <Skeleton className="h-9 w-24 bg-gray-700" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col bg-gray-200 p-3 sm:p-6">
          <div className="mx-auto flex min-h-[18rem] w-full max-w-4xl flex-1 flex-col rounded-lg border border-gray-300 bg-white p-6 shadow-sm sm:p-10">
            <div className="space-y-3">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <div className="mt-8 space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="space-y-1.5">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-11/12" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
            <div className="mt-auto grid grid-cols-1 gap-4 pt-10 sm:grid-cols-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        </div>
      </div>

      <span className="sr-only">{t("components.loading")}</span>
    </div>
  );
}
