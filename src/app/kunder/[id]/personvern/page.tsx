import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { formatDateLocalized } from "@/lib/dates";
import {
  getCustomerErasurePreview,
  type ErasureBlocker,
} from "@/server/customer-erasure";
import ErrorBanner from "@/components/ErrorBanner";
import CustomerToast from "@/components/customer/CustomerToast";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import {
  CUSTOMER_CARD,
  CUSTOMER_CONTROL,
  CUSTOMER_INK_BUTTON,
  CUSTOMER_LABEL,
  CUSTOMER_MUTED,
  CUSTOMER_RISK_BUTTON,
  LEGACY_SURFACE,
} from "@/components/customer/customerStyles";
import { eraseCustomerDataAction } from "./actions";

const COUNT_KEYS = [
  "contacts",
  "sites",
  "portalUsers",
  "workOrders",
  "reports",
  "reportRevisions",
  "reportUnits",
  "customerAttachments",
  "workOrderAttachments",
  "documents",
  "uploads",
  "comments",
  "messages",
  "bookingRequests",
  "contracts",
  "products",
  "customerSignaturesRemoved",
  "reportPdfsRetained",
  "filesScheduledForDeletion",
] as const;

function blockerText(
  blocker: ErasureBlocker,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  if (blocker.kind === "work_order_legal_hold") {
    return t("customers.privacy.blockers.workOrderLegalHold", {
      reference: blocker.label || blocker.entityId,
    });
  }
  if (blocker.kind === "report_legal_hold") {
    return t("customers.privacy.blockers.reportLegalHold", {
      reference: blocker.label || blocker.entityId,
    });
  }
  return t("customers.privacy.blockers.auditHold", {
    entityType: blocker.entityType,
    entityId: blocker.entityId,
  });
}

export default async function CustomerPrivacyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  const { id: customerId } = await params;
  const { error, status } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (user.role !== "ADMIN" || !user.isActive) {
    redirect(`/kunder/${customerId}`);
  }

  const result = await getCustomerErasurePreview(user, customerId);
  if (!result.ok) {
    if (result.reason === "not_found") notFound();
    redirect(`/kunder/${customerId}`);
  }

  const preview = result.data;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const hasBlockers = preview.blockers.length > 0;
  const canErase = !preview.alreadyAnonymised && !hasBlockers;

  const statusMessage =
    status === "slettet"
      ? t("customers.privacy.status.erased")
      : status === "allerede"
        ? t("customers.privacy.status.already")
        : null;
  const errorMessage =
    error === "forbudt"
      ? t("customers.privacy.status.errorForbidden")
      : error === "blokkert"
        ? t("customers.privacy.status.errorBlocked")
        : error === "ugyldig"
          ? t("customers.privacy.status.errorInvalid")
          : error
            ? t("customers.privacy.status.errorGeneric")
            : null;

  const eraseAction = eraseCustomerDataAction.bind(null, customerId);

  return (
    <div className={`office-app min-h-screen p-3 sm:p-6 lg:p-8 ${LEGACY_SURFACE}`}>
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={t("customers.privacy.title")}
          subtitle={t("customers.privacy.subtitle", {
            name: preview.customerName,
          })}
          icon={<Icon name="shield" className="h-5 w-5" />}
          actions={
            <Link
              href={`/kunder/${customerId}`}
              className={CUSTOMER_INK_BUTTON}
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("customers.privacy.back")}
            </Link>
          }
        />

        {statusMessage && <CustomerToast message={statusMessage} />}
        <ErrorBanner message={errorMessage ?? undefined} />

        {preview.alreadyAnonymised ? (
          <section className={`${CUSTOMER_CARD} rounded-card border border-[var(--line,#dedcd1)] p-5`}>
            <h2 className="flex items-center gap-2 text-base font-extrabold text-[var(--ink,#101310)]">
              <Icon name="shield" className="h-4 w-4" />
              {t("customers.privacy.alreadyTitle")}
            </h2>
            <p className={`mt-2 text-sm ${CUSTOMER_MUTED}`}>
              {t("customers.privacy.alreadyBody")}
            </p>
            {preview.anonymisedAt && (
              <p className={`mt-2 text-xs ${CUSTOMER_MUTED}`}>
                {t("customers.privacy.anonymisedAt", {
                  date: formatDateLocalized(preview.anonymisedAt, locale),
                })}
              </p>
            )}
          </section>
        ) : (
          <section className={`${CUSTOMER_CARD} rounded-card border border-[var(--line,#dedcd1)] p-5`}>
            <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
              {t("customers.privacy.introTitle")}
            </h2>
            <p className={`mt-2 text-sm ${CUSTOMER_MUTED}`}>
              {t("customers.privacy.intro")}
            </p>
            <p className="mt-3 rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] p-3 text-sm font-semibold text-[var(--risk-text,#b42318)]">
              {t("customers.privacy.irreversible")}
            </p>
          </section>
        )}

        <section className={`${CUSTOMER_CARD} rounded-card border border-[var(--line,#dedcd1)] p-5`}>
          <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
            {t("customers.privacy.previewTitle")}
          </h2>
          <p className={`mt-1 text-xs ${CUSTOMER_MUTED}`}>
            {t("customers.privacy.previewHint")}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {COUNT_KEYS.map((key) => (
              <div
                key={key}
                className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-3"
              >
                <dt className={`${CUSTOMER_LABEL} mb-1`}>
                  {t(`customers.privacy.counts.${key}`)}
                </dt>
                <dd className="text-lg font-black tabular-nums text-[var(--ink,#101310)]">
                  {preview.counts[key]}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={`${CUSTOMER_CARD} rounded-card border border-[var(--line,#dedcd1)] p-5`}>
          <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
            {t("customers.privacy.erasedTitle")}
          </h2>
          <ul className={`mt-2 list-disc space-y-1 pl-5 text-sm ${CUSTOMER_MUTED}`}>
            <li>{t("customers.privacy.erasedCustomer")}</li>
            <li>{t("customers.privacy.erasedContacts")}</li>
            <li>{t("customers.privacy.erasedSites")}</li>
            <li>{t("customers.privacy.erasedPortalUsers")}</li>
            <li>{t("customers.privacy.erasedOrders")}</li>
            <li>{t("customers.privacy.erasedReports")}</li>
            <li>{t("customers.privacy.erasedFiles")}</li>
          </ul>

          <h2 className="mt-5 text-base font-extrabold text-[var(--ink,#101310)]">
            {t("customers.privacy.preservedTitle")}
          </h2>
          <ul className={`mt-2 list-disc space-y-1 pl-5 text-sm ${CUSTOMER_MUTED}`}>
            <li>{t("customers.privacy.preservedOrders")}</li>
            <li>{t("customers.privacy.preservedReports")}</li>
            <li>{t("customers.privacy.preservedRevisions")}</li>
            <li>{t("customers.privacy.preservedPdfs")}</li>
            <li>{t("customers.privacy.preservedAudit")}</li>
          </ul>
        </section>

        <section className={`${CUSTOMER_CARD} rounded-card border border-[var(--line,#dedcd1)] p-5`}>
          <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
            {t("customers.privacy.blockersTitle")}
          </h2>
          {hasBlockers ? (
            <>
              <p className={`mt-1 text-sm ${CUSTOMER_MUTED}`}>
                {t("customers.privacy.blockersHint")}
              </p>
              <ul className="mt-3 space-y-2">
                {preview.blockers.map((blocker) => (
                  <li
                    key={`${blocker.kind}:${blocker.entityType}:${blocker.entityId}`}
                    className="rounded-xl border border-[#e7b5ae] bg-[#fdf4f2] p-3 text-sm text-[var(--risk-text,#b42318)]"
                  >
                    <p className="font-bold">{blockerText(blocker, t)}</p>
                    {blocker.reason && (
                      <p className="mt-1 text-xs">
                        {t("customers.privacy.blockers.reason", {
                          reason: blocker.reason,
                        })}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <p className={`mt-3 text-xs ${CUSTOMER_MUTED}`}>
                {t("customers.privacy.blockers.resolve")}
              </p>
            </>
          ) : (
            <p className={`mt-2 text-sm ${CUSTOMER_MUTED}`}>
              {t("customers.privacy.blockers.empty")}
            </p>
          )}
        </section>

        {canErase && (
          <section className={`${CUSTOMER_CARD} rounded-card border border-[#e7b5ae] p-5`}>
            <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
              {t("customers.privacy.formTitle")}
            </h2>
            <p className={`mt-1 text-xs ${CUSTOMER_MUTED}`}>
              {t("customers.privacy.formHint")}
            </p>
            <form action={eraseAction} className="mt-4 space-y-4">
              <div>
                <label htmlFor="reason" className={CUSTOMER_LABEL}>
                  {t("customers.privacy.reason")}
                </label>
                <textarea
                  id="reason"
                  name="reason"
                  required
                  minLength={3}
                  maxLength={500}
                  rows={3}
                  className={CUSTOMER_CONTROL}
                  placeholder={t("customers.privacy.reasonPlaceholder")}
                />
              </div>
              <div>
                <label htmlFor="confirmation" className={CUSTOMER_LABEL}>
                  {t("customers.privacy.confirmation", {
                    name: preview.customerName,
                  })}
                </label>
                <input
                  id="confirmation"
                  name="confirmation"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  className={CUSTOMER_CONTROL}
                />
                <p className={`mt-1 text-xs ${CUSTOMER_MUTED}`}>
                  {t("customers.privacy.confirmationHint")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={CUSTOMER_RISK_BUTTON}>
                  <Icon name="trash" className="h-4 w-4" />
                  {t("customers.privacy.submit")}
                </button>
                <Link
                  href={`/kunder/${customerId}`}
                  className={CUSTOMER_INK_BUTTON}
                >
                  {t("customers.privacy.cancel")}
                </Link>
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
