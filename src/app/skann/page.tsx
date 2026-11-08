import { requireModulePage } from "@/lib/module-guards";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import BarcodeScanner from "@/components/scanner/BarcodeScanner";
import ScannerNotice from "@/components/scanner/ScannerNotice";
import Icon from "@/components/icons";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { resolveScanCode, type ScanFailure } from "@/server/scan";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("scanner.title") };
}

function errorKey(reason: ScanFailure): string {
  if (reason === "invalid") return "scanner.errors.invalid";
  if (reason === "forbidden") return "scanner.errors.forbidden";
  return "scanner.errors.notFound";
}

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ kode?: string | string[] }>;
}) {
  await requireModulePage("equipment");
  const t = await getTranslations("common");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin?callbackUrl=%2Fskann");
  if (
    !hasPermission(user, "workorders.view") &&
    !hasPermission(user, "equipment.view")
  ) {
    redirect("/");
  }

  const query = await searchParams;
  const code =
    typeof query.kode === "string"
      ? query.kode
      : Array.isArray(query.kode)
        ? query.kode[0]
        : "";

  let error = "";
  if (code.trim()) {
    const result = await resolveScanCode(user, code);
    if (result.ok) redirect(result.href);
    error = t(errorKey(result.reason));
  }

  return (
    <div className="field-app min-h-screen p-4 pb-[calc(6rem_+_env(safe-area-inset-bottom))] sm:p-6">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-paper">
              <Icon name="camera" className="h-6 w-6 shrink-0 text-signal" />
              {t("scanner.title")}
            </h1>
            <p className="mt-1 text-sm font-medium text-paper/70">
              {t("scanner.intro")}
            </p>
          </div>
          <Link
            href="/mine-oppdrag"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[#2a3328] bg-white/5 px-3 text-sm font-bold text-paper transition hover:bg-white/10"
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("scanner.backToField")}
          </Link>
        </div>

        <ScannerNotice kind="error">{error}</ScannerNotice>

        <section className="field-card p-4 sm:p-5">
          <BarcodeScanner />
        </section>

      </div>
    </div>
  );
}
