import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateTimeLocalized } from "@/lib/dates";
import { parsePage } from "@/lib/pagination";
import { listMessageThreads } from "@/server/messaging";
import { startWorkOrderThreadAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("sms.page.title") };
}

const CARD = "office-card";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)]";
const MUTED = "text-xs text-[var(--muted,#62685f)]";

function errorKey(reason: string | undefined): string | null {
  if (!reason) return null;
  if (reason === "forbidden") return "sms.errors.forbidden";
  if (reason === "not_found") return "sms.errors.not_found";
  if (reason === "invalid" || reason === "missing_fields" || reason === "invalid_contact") {
    return "sms.errors.invalid";
  }
  return "sms.errors.generic";
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{
    side?: string;
    u?: string;
    q?: string;
    oppdrag?: string;
    kunde?: string;
    error?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (
    !hasPermission(user, "workorders.view") &&
    !hasPermission(user, "workorders.update") &&
    !hasPermission(user, "workorders.edit")
  ) {
    redirect("/");
  }

  const t = await getTranslations("common");
  const locale = await getLocale();
  const params = await searchParams;
  const page = parsePage(params.side);
  const unreadOnly = params.u === "1";
  const query = (params.q ?? "").trim().slice(0, 100);
  const workOrderId = (params.oppdrag ?? "").trim().slice(0, 64);
  const customerId = (params.kunde ?? "").trim().slice(0, 64);

  const result = await listMessageThreads(user, {
    page,
    unreadOnly,
    query,
    workOrderId,
    customerId,
  });
  if (!result.ok) redirect("/");

  const data = result.data;
  const pageLink = (target: number) => {
    const next = new URLSearchParams();
    if (unreadOnly) next.set("u", "1");
    if (query) next.set("q", query);
    if (workOrderId) next.set("oppdrag", workOrderId);
    if (customerId) next.set("kunde", customerId);
    if (target > 1) next.set("side", String(target));
    const qs = next.toString();
    return `/meldinger${qs ? `?${qs}` : ""}`;
  };

  const clearHref = unreadOnly ? "/meldinger?u=1" : "/meldinger";
  const errorMessage = errorKey(params.error);

  return (
    <div className="mx-auto min-h-screen max-w-4xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title={t("sms.page.title")}
        subtitle={t("sms.page.subtitle", { unread: data.unread })}
        icon={<Icon name="mail" className="h-5 w-5" />}
        actions={
          <>
            <Link
              href={unreadOnly ? clearHref : "/meldinger?u=1"}
              className={INK_BUTTON}
            >
              <Icon name="filter" className="h-4 w-4 shrink-0" />
              {unreadOnly ? t("sms.page.all") : t("sms.page.unreadOnly")}
            </Link>
            <Link href="/" className={INK_BUTTON}>
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("dashboard")}
            </Link>
          </>
        }
      />

      {errorMessage && (
        <p
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[#fbe9e7] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t(errorMessage)}
        </p>
      )}

      <form className={`${CARD} flex flex-wrap gap-2 p-3`} action="/meldinger">
        {unreadOnly && <input type="hidden" name="u" value="1" />}
        {workOrderId && <input type="hidden" name="oppdrag" value={workOrderId} />}
        {customerId && <input type="hidden" name="kunde" value={customerId} />}
        <label htmlFor="sms-search" className="sr-only">
          {t("sms.page.search")}
        </label>
        <input
          id="sms-search"
          name="q"
          type="search"
          defaultValue={query}
          placeholder={t("sms.page.searchPlaceholder")}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm"
        />
        <button type="submit" className={SIGNAL_BUTTON}>
          {t("sms.page.search")}
        </button>
        {(query || workOrderId || customerId) && (
          <Link href="/meldinger" className={INK_BUTTON}>
            {t("sms.page.clearFilters")}
          </Link>
        )}
      </form>

      {data.threads.length === 0 ? (
        <div className={`${CARD} p-10 text-center`}>
          <p className="flex justify-center text-[var(--muted,#62685f)]" aria-hidden="true">
            <Icon name="mail" className="h-8 w-8" />
          </p>
          <p className="mt-2 font-extrabold text-[var(--ink,#101310)]">
            {t("sms.page.emptyTitle")}
          </p>
          <p className={`text-sm ${MUTED}`}>{t("sms.page.emptyDescription")}</p>
          {workOrderId && (
            <form action={startWorkOrderThreadAction} className="mt-4">
              <input type="hidden" name="workOrderId" value={workOrderId} />
              <button type="submit" className={SIGNAL_BUTTON}>
                {t("sms.page.startThread")}
              </button>
            </form>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {data.threads.map((thread) => {
            const last = thread.messages[0];
            return (
              <li key={thread.id} className={`${CARD} p-0`}>
                <Link
                  href={`/meldinger/${thread.id}`}
                  className="block p-4 transition-colors hover:bg-[var(--paper,#f2efe6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ink,#101310)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-extrabold text-[var(--ink,#101310)]">
                        {thread.customer.name}
                      </p>
                      <p className={`mt-0.5 truncate ${MUTED}`}>
                        {thread.contact?.name ?? t("sms.thread.contact")}
                        {thread.workOrder ? ` · ${thread.workOrder.title}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {thread.unreadCount > 0 && (
                        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--signal,#d8ff3e)] px-2 py-0.5 text-xs font-black text-[var(--ink,#101310)]">
                          {thread.unreadCount}
                        </span>
                      )}
                      <time className={MUTED}>
                        {formatDateTimeLocalized(thread.lastMessageAt, locale)}
                      </time>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-[#2a2f28]">
                    {last?.body ?? t("sms.page.noMessages")}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {data.totalPages > 1 && (
        <nav className={`${CARD} flex items-center justify-between gap-3 p-2 text-xs`}>
          {data.page > 1 ? (
            <Link href={pageLink(data.page - 1)} className={INK_BUTTON}>
              {t("sms.page.previous")}
            </Link>
          ) : (
            <span aria-disabled="true" className={`px-3 py-2 font-bold ${MUTED}`}>
              {t("sms.page.previous")}
            </span>
          )}
          <span className={MUTED}>
            {t("sms.page.pageOf", { page: data.page, pages: data.totalPages })}
          </span>
          {data.page < data.totalPages ? (
            <Link href={pageLink(data.page + 1)} className={INK_BUTTON}>
              {t("sms.page.next")}
            </Link>
          ) : (
            <span aria-disabled="true" className={`px-3 py-2 font-bold ${MUTED}`}>
              {t("sms.page.next")}
            </span>
          )}
        </nav>
      )}
    </div>
  );
}
