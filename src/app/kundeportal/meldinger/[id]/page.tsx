import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { formatDateTimeLocalized } from "@/lib/dates";
import PortalShell from "@/components/portal/PortalShell";
import { brandCard } from "@/components/ui/brandStyles";
import { getPortalMessageThread } from "@/server/portal-expansion";
import PortalMessageForm from "../PortalMessageForm";
import { PortalNoAccess, loadPortalPage } from "../../portal-page";

export default async function PortalMessageThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const { id } = await params;
  const result = await getPortalMessageThread(context.user, id);

  if (!result.ok && result.reason === "not_found") notFound();

  return (
    <PortalShell
      active="meldinger"
      customer={context.customer}
      userName={context.user.name ?? context.user.email ?? ""}
    >
      <section className={`${brandCard} p-4 sm:p-5`}>
        <Link
          href="/kundeportal/meldinger"
          className="inline-flex min-h-11 items-center text-sm font-bold underline decoration-2 underline-offset-4"
        >
          {t("portal.expansion.messages.back")}
        </Link>

        {!result.ok ? (
          <p className="mt-4 text-sm text-[var(--muted,#62685f)]">
            {t("portal.expansion.messages.errors.notFound")}
          </p>
        ) : (
          <>
            <h2 className="mt-2 break-words text-lg font-extrabold tracking-tight">
              {result.data.thread.subject ||
                result.data.thread.workOrder?.title ||
                t("portal.expansion.messages.noSubject")}
            </h2>
            <ol className="mt-4 space-y-3">
              {result.data.thread.messages.map((message) => {
                const mine = message.authorUserId === context.user.id;
                return (
                  <li
                    key={message.id}
                    className={`max-w-[85%] rounded-2xl border p-3 ${
                      mine
                        ? "ml-auto border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)]"
                        : "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)]"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {message.body}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
                      {formatDateTimeLocalized(message.createdAt, locale)}
                      {" · "}
                      {t(
                        mine
                          ? "portal.expansion.messages.fromYou"
                          : "portal.expansion.messages.fromOffice",
                      )}
                    </p>
                  </li>
                );
              })}
            </ol>
            <div className="mt-4 border-t border-[var(--line,#dedcd1)] pt-4">
              <PortalMessageForm
                threadId={result.data.thread.id}
                consent={result.data.consent}
              />
            </div>
          </>
        )}
      </section>
    </PortalShell>
  );
}
