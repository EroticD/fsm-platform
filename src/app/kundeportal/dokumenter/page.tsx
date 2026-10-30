import { getTranslations } from "next-intl/server";
import { getLocale } from "next-intl/server";
import { formatDateLocalized } from "@/lib/dates";
import { parsePage } from "@/lib/pagination";
import Pagination, { paginationLabels } from "@/components/Pagination";
import PortalShell from "@/components/portal/PortalShell";
import { brandCard } from "@/components/ui/brandStyles";
import { getPortalDocuments } from "@/server/portal-expansion";
import { PortalNoAccess, loadPortalPage } from "../portal-page";

function formatBytes(bytes: number, locale: string): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${units[index]}`;
}

export default async function PortalDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string }>;
}) {
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;

  if (!context.access.capabilities.canViewDocuments) {
    return (
      <PortalShell
        active="dokumenter"
        customer={context.customer}
        userName={context.user.name ?? context.user.email ?? ""}
      >
        <section className={brandCard}>
          <h2 className="text-lg font-extrabold">
            {t("portal.expansion.documents.title")}
          </h2>
          <p className="mt-2 text-sm text-[var(--muted,#62685f)]">
            {t("portal.expansion.documents.forbidden")}
          </p>
        </section>
      </PortalShell>
    );
  }

  const result = await getPortalDocuments(context.user, {
    page: parsePage(params.side),
  });

  return (
    <PortalShell
      active="dokumenter"
      customer={context.customer}
      userName={context.user.name ?? context.user.email ?? ""}
    >
      <section className={`${brandCard} p-4 sm:p-5`}>
        <h2 className="text-lg font-extrabold tracking-tight">
          {t("portal.expansion.documents.title")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
          {t("portal.expansion.documents.intro")}
        </p>

        {!result.ok ? (
          <p className="mt-4 text-sm text-[var(--muted,#62685f)]">
            {t("portal.expansion.documents.forbidden")}
          </p>
        ) : result.data.items.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-4 text-sm italic text-[var(--muted,#62685f)]">
            {t("portal.expansion.documents.empty")}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--line,#dedcd1)]">
            {result.data.items.map((document) => (
              <li
                key={document.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold">{document.name}</p>
                  <p className="text-xs text-[var(--muted,#62685f)]">
                    {formatDateLocalized(
                      document.uploadedAt,
                      locale,
                      undefined,
                      t("portal.expansion.common.unknownDate"),
                    )}{" "}
                    · {formatBytes(document.size, locale)}
                  </p>
                </div>
                <a
                  href={document.url}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-[var(--ink,#101310)] px-4 text-sm font-bold transition hover:bg-[var(--paper,#f2efe6)]"
                >
                  {t("portal.expansion.documents.download")}
                </a>
              </li>
            ))}
          </ul>
        )}

        {result.ok && (
          <Pagination
            page={result.data.page}
            totalPages={result.data.totalPages}
            hrefFor={(page) =>
              `/kundeportal/dokumenter${page > 1 ? `?side=${page}` : ""}`
            }
            labels={paginationLabels(t)}
            className="pt-3"
          />
        )}
      </section>
    </PortalShell>
  );
}
