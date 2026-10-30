import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateTimeLocalized } from "@/lib/dates";
import { getMessageThread } from "@/server/messaging";
import {
  sendMessageAction,
  sendQuickMessageAction,
  setConsentAction,
} from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("sms.thread.title") };
}

const CARD = "office-card";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]";
const SIGNAL_BUTTON =
  "signal-button text-xs shadow-[2px_2px_0_var(--ink,#101310)]";
const MUTED = "text-xs text-[var(--muted,#62685f)]";
const INPUT =
  "min-h-11 w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-sm text-[var(--ink,#101310)]";

function feedbackKey(kind: "ok" | "error", value: string | undefined): string | null {
  if (kind === "ok") {
    if (value === "sent") return "sms.thread.sent";
    if (value === "consent") return "sms.consent.granted";
    if (value === "revoked") return "sms.consent.revoked";
    return null;
  }
  if (!value) return null;
  if (value === "forbidden") return "sms.errors.forbidden";
  if (value === "not_found") return "sms.errors.not_found";
  if (value === "rate_limited") return "sms.errors.rate_limited";
  if (value === "invalid_contact" || value === "missing_contact") {
    return "sms.errors.invalid_contact";
  }
  if (value === "invalid" || value === "missing_fields") {
    return "sms.errors.invalid";
  }
  return "sms.errors.generic";
}

const QUICK_EVENTS = [
  ["BOOKING_CONFIRMED", "sms.thread.quickBooking"],
  ["VISIT_REMINDER", "sms.thread.quickReminder"],
  ["ON_MY_WAY", "sms.thread.quickOnMyWay"],
  ["VISIT_DONE", "sms.thread.quickDone"],
  ["REVIEW_REQUEST", "sms.thread.quickReview"],
] as const;

export default async function MessageThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
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
  const { id } = await params;
  const query = await searchParams;
  const result = await getMessageThread(user, id);
  if (!result.ok) {
    if (result.reason === "not_found") redirect("/meldinger");
    redirect("/");
  }

  const { thread, consent, smsStatuses } = result.data;
  const success = feedbackKey("ok", query.ok);
  const failure = feedbackKey("error", query.error);
  const canWrite =
    hasPermission(user, "workorders.update") ||
    hasPermission(user, "workorders.edit");

  return (
    <div className="mx-auto min-h-screen max-w-4xl space-y-5 p-4 sm:p-6">
      <PageHeader
        title={t("sms.thread.title")}
        subtitle={thread.customer.name}
        icon={<Icon name="mail" className="h-5 w-5" />}
        actions={
          <Link href="/meldinger" className={INK_BUTTON}>
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("sms.thread.back")}
          </Link>
        }
      />

      {success && (
        <p className="rounded-xl border border-[#b9c99a] bg-[#eef7d6] p-3 text-sm font-bold text-[#283509]">
          {t(success)}
        </p>
      )}
      {failure && (
        <p
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[#fbe9e7] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t(failure)}
        </p>
      )}

      <section className={`${CARD} grid gap-3 p-4 sm:grid-cols-3`}>
        <div>
          <p className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">
            {t("sms.thread.customer")}
          </p>
          <Link
            href={`/kunder/${thread.customerId}`}
            className="mt-0.5 block truncate font-bold text-[var(--ink,#101310)] hover:underline"
          >
            {thread.customer.name}
          </Link>
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">
            {t("sms.thread.contact")}
          </p>
          <p className="mt-0.5 truncate font-bold text-[var(--ink,#101310)]">
            {thread.contact?.name ?? "–"}
          </p>
          {thread.contact?.phone && (
            <a
              href={`tel:${thread.contact.phone}`}
              className="text-xs font-medium text-[#3d4237] hover:underline"
            >
              {thread.contact.phone}
            </a>
          )}
        </div>
        <div>
          <p className="text-xs font-bold uppercase text-[var(--muted,#62685f)]">
            {t("sms.thread.workOrder")}
          </p>
          {thread.workOrder ? (
            <Link
              href={`/oppdrag/${thread.workOrder.id}`}
              className="mt-0.5 block truncate font-bold text-[var(--ink,#101310)] hover:underline"
            >
              {thread.workOrder.title}
            </Link>
          ) : (
            <p className="mt-0.5 font-bold text-[var(--muted,#62685f)]">–</p>
          )}
        </div>
      </section>

      <section className={`${CARD} space-y-3 p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-extrabold text-[var(--ink,#101310)]">
              {t("sms.consent.title")}
            </h2>
            <p className={`mt-1 max-w-2xl text-sm text-[#2a2f28]`}>
              {t("sms.consent.description")}
            </p>
          </div>
          <span
            className={`rounded-full border px-2.5 py-1 text-xs font-black ${
              consent
                ? "border-[#b9c99a] bg-[#eef7d6] text-[#283509]"
                : "border-[#e7b5ae] bg-[#fbe9e7] text-[var(--risk-text,#b42318)]"
            }`}
          >
            {consent ? t("sms.consent.optedIn") : t("sms.consent.unknown")}
          </span>
        </div>

        {thread.contactId && canWrite && (
          <form action={setConsentAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="threadId" value={thread.id} />
            <input type="hidden" name="contactId" value={thread.contactId} />
            <input
              type="hidden"
              name="optedIn"
              value={consent ? "false" : "true"}
            />
            <button type="submit" className={consent ? INK_BUTTON : SIGNAL_BUTTON}>
              {consent ? t("sms.consent.revoke") : t("sms.consent.grant")}
            </button>
          </form>
        )}
      </section>

      {thread.workOrderId && consent && canWrite && (
        <section className={`${CARD} space-y-3 p-4`}>
          <div>
            <h2 className="font-extrabold text-[var(--ink,#101310)]">
              {t("sms.thread.quickTitle")}
            </h2>
            <p className={`mt-1 text-sm ${MUTED}`}>
              {t("sms.thread.quickHint")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK_EVENTS.map(([eventKey, labelKey]) => (
              <form key={eventKey} action={sendQuickMessageAction}>
                <input type="hidden" name="threadId" value={thread.id} />
                <input
                  type="hidden"
                  name="workOrderId"
                  value={thread.workOrderId ?? ""}
                />
                <input type="hidden" name="eventKey" value={eventKey} />
                <button type="submit" className={INK_BUTTON}>
                  {t(labelKey)}
                </button>
              </form>
            ))}
          </div>
        </section>
      )}

      <section className={`${CARD} p-4`}>
        {thread.messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--muted,#62685f)]">
            {t("sms.thread.empty")}
          </p>
        ) : (
          <ol className="space-y-3">
            {thread.messages.map((message) => {
              const inbound = message.direction === "INBOUND";
              const smsStatus = message.smsMessageId
                ? smsStatuses[message.smsMessageId]
                : undefined;
              return (
                <li
                  key={message.id}
                  className={`flex ${inbound ? "justify-start" : "justify-end"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl border px-3 py-2 text-sm ${
                      inbound
                        ? "border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] text-[var(--ink,#101310)]"
                        : "border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)]"
                    }`}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide opacity-70">
                      <span>
                        {inbound
                          ? t("sms.thread.inbound")
                          : t("sms.thread.outbound")}
                      </span>
                      <time dateTime={message.createdAt.toISOString()}>
                        {formatDateTimeLocalized(message.createdAt, locale)}
                      </time>
                      {smsStatus && (
                        <span>
                          {t("sms.thread.status")}: {t(`sms.status.${smsStatus}`)}
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-line break-words">{message.body}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {canWrite && (
        <section className={`${CARD} p-4`}>
          {consent ? (
            <form action={sendMessageAction} className="space-y-3">
              <input type="hidden" name="threadId" value={thread.id} />
              <label htmlFor="sms-message-body" className="sr-only">
                {t("sms.thread.placeholder")}
              </label>
              <textarea
                id="sms-message-body"
                name="body"
                rows={4}
                required
                maxLength={1600}
                placeholder={t("sms.thread.placeholder")}
                className={INPUT}
              />
              <button type="submit" className={SIGNAL_BUTTON}>
                {t("sms.thread.send")}
              </button>
            </form>
          ) : (
            <p className="text-sm font-bold text-[var(--risk-text,#b42318)]">
              {t("sms.errors.noConsent")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
