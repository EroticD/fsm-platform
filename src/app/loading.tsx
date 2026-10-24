import { getTranslations } from "next-intl/server";
import SkeletonList from "@/components/Skeleton";

export default async function Loading() {
  const t = await getTranslations("common");

  return (
    <div
      className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6"
      role="status"
      aria-live="polite"
    >
      <div className="h-8 w-1/3 animate-pulse rounded-lg bg-gray-200" />
      <SkeletonList count={4} />
      <span className="sr-only">{t("components.loading")}</span>
    </div>
  );
}
