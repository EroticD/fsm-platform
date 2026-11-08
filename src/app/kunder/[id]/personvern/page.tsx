import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/session";
import { formatDateLocalized } from "@/lib/dates";
import {
  getCustomerErasurePreview,
  type ErasureBlocker,
} from "@/server/customer-erasure";
import Card from "@/components/ui/Card";
import { brandInset } from "@/components/ui/brandStyles";
import { buttonClassName } from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import ErrorBanner from "@/components/ErrorBanner";
import CustomerToast from "@/components/customer/CustomerToast";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
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
    <PageShell size="narrow">
      <PageHeader
        title={t("customers.privacy.title")}
        subtitle={t("customers.privacy.subtitle", {
          name: preview.customerName,
        })}
        icon={<Icon name="shield" className="h-5 w-5" />}
        actions={
          <Link
            href={`/kunder/${customerId}`}
            className={buttonClassName({ variant: "secondary" })}
          >
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("customers.privacy.back")}
          </Link>
        }
      />

      {statusMessage && <CustomerToast message={statusMessage} />}
      <ErrorBanner message={errorMessage ?? undefined} />

      {preview.alreadyAnonymised ? (
      <Card as="section" className="p-5">
        <h2 className="type-title-3 flex items-center gap-2 text-[var(--ink,#101310)]">
          <Icon name="shield" className="h-4 w-4" />
          {t("customers.privacy.alreadyTitle")}
        </h2>
        <p className="type-body mt-2 text-[var(--muted,#62685f)]">
          {t("customers.privacy.alreadyBody")}
        </p>
        {preview.anonymisedAt && (
          <p className="type-meta mt-2 text-[var(--muted,#62685f)]">
            {t("customers.privacy.anonymisedAt", {
              date: formatDateLocalized(preview.anonymisedAt, locale),
            })}
          </p>
        )}
      </Card>
      ) : (
      <Card as="section" className="p-5">
        <h2 className="type-title-3 text-[var(--ink,#101310)]">
          {t("customers.privacy.introTitle")}
        </h2>
        <p className="type-body mt-2 text-[var(--muted,#62685f)]">
          {t("customers.privacy.intro")}
        </p>
        <p className="type-ui mt-3 rounded-xl border border-[color-mix(in_srgb,var(--risk-text,#b42318)_22%,transparent)] bg-[var(--risk-surface,#fdf4f2)] p-3 text-[var(--risk-text,#b42318)]">
          {t("customers.privacy.irreversible")}
        </p>
      </Card>
      )}

      <Card as="section" className="p-5">
      <h2 className="type-title-3 text-[var(--ink,#101310)]">
        {t("customers.privacy.previewTitle")}
      </h2>
      <p className="type-meta mt-1 text-[var(--muted,#62685f)]">
        {t("customers.privacy.previewHint")}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {COUNT_KEYS.map((key) => (
          <div key={key} className={`${brandInset} p-3`}>
            <dt className="type-eyebrow mb-1 text-[var(--muted,#62685f)]">
              {t(`customers.privacy.counts.${key}`)}
            </dt>
            <dd className="type-title-3 tabular-nums text-[var(--ink,#101310)]">
              {preview.counts[key]}
            </dd>
          </div>
        ))}
      </dl>
      </Card>

      <Card as="section" className="p-5">
      <h2 className="type-title-3 text-[var(--ink,#101310)]">
        {t("customers.privacy.erasedTitle")}
      </h2>
      <ul className="type-ui mt-2 list-disc space-y-1 pl-5 text-[var(--muted,#62685f)]">
        <li>{t("customers.privacy.erasedCustomer")}</li>
        <li>{t("customers.privacy.erasedContacts")}</li>
        <li>{t("customers.privacy.erasedSites")}</li>
        <li>{t("customers.privacy.erasedPortalUsers")}</li>
        <li>{t("customers.privacy.erasedOrders")}</li>
        <li>{t("customers.privacy.erasedReports")}</li>
        <li>{t("customers.privacy.erasedFiles")}</li>
      </ul>

      <h2 className="type-title-3 mt-5 text-[var(--ink,#101310)]">
        {t("customers.privacy.preservedTitle")}
      </h2>
      <ul className="type-ui mt-2 list-disc space-y-1 pl-5 text-[var(--muted,#62685f)]">
        <li>{t("customers.privacy.preservedOrders")}</li>
        <li>{t("customers.privacy.preservedReports")}</li>
        <li>{t("customers.privacy.preservedRevisions")}</li>
        <li>{t("customers.privacy.preservedPdfs")}</li>
        <li>{t("customers.privacy.preservedAudit")}</li>
      </ul>
      </Card>

      <Card as="section" className="p-5">
      <h2 className="type-title-3 text-[var(--ink,#101310)]">
        {t("customers.privacy.blockersTitle")}
      </h2>
      {hasBlockers ? (
        <>
          <p className="type-ui mt-1 text-[var(--muted,#62685f)]">
            {t("customers.privacy.blockersHint")}
          </p>
          <ul className="mt-3 space-y-2">
            {preview.blockers.map((blocker) => (
              <li
                key={`${blocker.kind}:${blocker.entityType}:${blocker.entityId}`}
                className="rounded-xl border border-[color-mix(in_srgb,var(--risk-text,#b42318)_22%,transparent)] bg-[var(--risk-surface,#fdf4f2)] p-3 text-sm text-[var(--risk-text,#b42318)]"
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
          <p className="type-meta mt-3 text-[var(--muted,#62685f)]">
            {t("customers.privacy.blockers.resolve")}
          </p>
        </>
      ) : (
        <p className="type-ui mt-2 text-[var(--muted,#62685f)]">
          {t("customers.privacy.blockers.empty")}
        </p>
      )}
      </Card>

      {canErase && (
      <Card
          as="section"
          className="border-[color-mix(in_srgb,var(--risk-text,#b42318)_22%,transparent)] p-5"
      >
        <h2 className="type-title-3 text-[var(--ink,#101310)]">
          {t("customers.privacy.formTitle")}
        </h2>
        <p className="type-meta mt-1 text-[var(--muted,#62685f)]">
          {t("customers.privacy.formHint")}
        </p>
        <form action={eraseAction} className="mt-4 space-y-4">
          <Field
            id="reason"
            label={t("customers.privacy.reason")}
            required
          >
            <Textarea
              id="reason"
              name="reason"
              required
              minLength={3}
              maxLength={500}
              rows={3}
              placeholder={t("customers.privacy.reasonPlaceholder")}
            />
          </Field>
          <Field
            id="confirmation"
            label={t("customers.privacy.confirmation", {
              name: preview.customerName,
            })}
            hint={t("customers.privacy.confirmationHint")}
            required
          >
            <Input
              id="confirmation"
              name="confirmation"
              required
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={buttonClassName({ variant: "danger" })}
            >
              <Icon name="trash" className="h-4 w-4" />
              {t("customers.privacy.submit")}
            </button>
            <Link
              href={`/kunder/${customerId}`}
              className={buttonClassName({ variant: "secondary" })}
            >
              {t("customers.privacy.cancel")}
            </Link>
          </div>
        </form>
      </Card>
      )}
    </PageShell>
  );
}
