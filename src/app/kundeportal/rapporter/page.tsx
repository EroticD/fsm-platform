import { getTranslations } from "next-intl/server";
import { parsePage } from "@/lib/pagination";
import PortalShell from "@/components/portal/PortalShell";
import ReportHistory from "@/components/portal/ReportHistory";
import { brandCard } from "@/components/ui/brandStyles";
import { PortalNoAccess, loadPortalPage } from "../portal-page";

export default async function PortalReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string }>;
}) {
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const t = await getTranslations("common");
  const params = await searchParams;

  return (
    <PortalShell
      active="rapporter"
      customer={context.customer}
      userName={context.user.name ?? context.user.email ?? ""}
    >
      {context.access.capabilities.canViewDocuments ? (
        <ReportHistory page={parsePage(params.side)} />
      ) : (
        <section className={brandCard}>
          <h2 className="text-lg font-extrabold">
            {t("portal.expansion.reports.title")}
          </h2>
          <p className="mt-2 text-sm text-[var(--muted,#62685f)]">
            {t("portal.expansion.reports.forbidden")}
          </p>
        </section>
      )}
    </PortalShell>
  );
}
