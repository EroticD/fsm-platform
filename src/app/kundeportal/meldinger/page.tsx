import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { formatDateTimeLocalized } from "@/lib/dates";
import { parsePage } from "@/lib/pagination";
import Pagination, { paginationLabels } from "@/components/Pagination";
import PortalShell from "@/components/portal/PortalShell";
import { brandCard, brandInset } from "@/components/ui/brandStyles";
import { getPortalMessageThreads } from "@/server/portal-expansion";
import { PortalNoAccess, loadPortalPage } from "../portal-page";

export default async function PortalMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string }>;
}) {
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;
  const result = await getPortalMessageThreads(context.user, {
    page: parsePage(params.side),
  });

  return (
    <PortalShell
      active="meldinger"
      customer={context.customer}
      userName={context.user.name ?? context.user.email ?? ""}
    >
      <section className={`${brandCard} p-4 sm:p-5`}>
        <h2 className="text-lg font-extrabold tracking-tight">
          {t("portal.expansion.messages.title")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
          {t("portal.expansion.messages.intro")}
        </p>

        {!result.ok ? (
          <p className="mt-4 text-sm text-[var(--muted,#62685f)]">
            {t("portal.expansion.messages.errors.forbidden")}
          </p>
        ) : result.data.threads.length === 0 ? (
          <p className="mt-4 text-sm italic text-[var(--muted,#62685f)]">
            {t("portal.expansion.messages.empty")}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--line,#dedcd1)]">
            {result.data.threads.map((thread) => {
              const last = thread.messages[0];
              return (
                <li key={thread.id}>
                  <Link
                    href={`/kundeportal/meldinger/${thread.id}`}
                    className={`${brandInset} mt-2 flex min-h-11 flex-col gap-1 p-3 transition hover:border-[var(--ink,#101310)]`}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="break-words text-sm font-bold">
                        {thread.subject ||
                          thread.workOrder?.title ||
                          t("portal.expansion.messages.noSubject")}
                      </span>
                      {thread.unreadCount > 0 && (
                        <span className="rounded-full bg-[var(--signal,#d8ff3e)] px-2 py-0.5 text-xs font-bold text-[var(--ink,#101310)]">
                          {t("portal.expansion.messages.unread", {
                            count: thread.unreadCount,
                          })}
                        </span>
                      )}
                    </span>
                    {last && (
                      <span className="line-clamp-2 break-words text-xs text-[var(--muted,#62685f)]">
                        {last.body}
                      </span>
                    )}
                    <span className="text-xs text-[var(--muted,#62685f)]">
                      {formatDateTimeLocalized(thread.lastMessageAt, locale)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {result.ok && (
          <Pagination
            page={result.data.page}
            totalPages={result.data.totalPages}
            hrefFor={(page) =>
              `/kundeportal/meldinger${page > 1 ? `?side=${page}` : ""}`
            }
            labels={paginationLabels(t)}
            className="pt-3"
          />
        )}
      </section>
    </PortalShell>
  );
}
