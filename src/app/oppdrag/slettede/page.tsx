import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { formatDateLocalized } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import Card from "@/components/ui/Card";
import { buttonClassName } from "@/components/ui/Button";
import SubmitButton from "@/components/SubmitButton";
import EmptyState from "@/components/EmptyState";
import ErrorBanner from "@/components/ErrorBanner";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import { restoreWorkOrder } from "./actions";

const DELETED_ERROR_MESSAGE_KEYS: Record<string, string> = {
  "ugyldig-data": "orders.errors.invalidData",
  "ikke-tilgang": "orders.errors.forbidden",
  "ikke-funnet": "orders.errors.notFound",
  ukjent: "orders.errors.generic",
};

/**
 * Gjenoppretting av mykt slettede oppdrag. Siden er administrator-only og
 * viser bare rader som fortsatt er innenfor bevaringsperioden.
 */
export default async function DeletedWorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (user.role !== "ADMIN") redirect("/oppdrag");

  const { error, ok } = await searchParams;
  const t = await getTranslations("common");
  const locale = await getLocale();
  const errorKey = error
    ? (DELETED_ERROR_MESSAGE_KEYS[error] ?? "orders.errors.generic")
    : undefined;
  const restored = ok === "gjenopprettet";

  const orders = await prisma.workOrder.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      deletedAt: true,
      deletedBy: true,
      customer: { select: { name: true } },
    },
  });

  return (
    <PageShell size="narrow">
      <PageHeader
        eyebrow={t("metadata.routes.oppdrag")}
        title={t("orders.detail.deletedOrders")}
        icon={<Icon name="trash" className="h-5 w-5" />}
        actions={
          <Link
            href="/oppdrag"
            className={buttonClassName({ variant: "secondary" })}
          >
            {t("orders.list.backToDashboard")}
          </Link>
        }
      />

      <ErrorBanner message={errorKey ? t(errorKey) : undefined} />

      {restored && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-2xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] px-5 py-4 text-sm font-bold text-[var(--success-text,#283509)]"
        >
          <Icon name="check" className="h-4 w-4 shrink-0" />
          {t("orders.detail.restored")}
        </div>
      )}

      <div className="rounded-2xl border border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_28%,transparent)] bg-[var(--warning-surface,#fdf5e4)] p-4 text-sm text-[var(--warning-text,#7a4f0c)]">
        <p className="font-black">{t("orders.detail.deletedInfoTitle")}</p>
        <p className="mt-1">{t("orders.detail.deletedInfo")}</p>
        <p className="mt-1 text-xs font-medium">
          {t("orders.detail.deletedRetention")}
        </p>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={<Icon name="trash" className="h-6 w-6" />}
          title={t("orders.detail.noDeletedOrders")}
        />
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <Card
              as="article"
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="type-ui truncate text-[var(--ink,#101310)]">
                  {order.title}
                </p>
                <p className="type-meta mt-1 flex items-center gap-1.5 text-[var(--muted,#62685f)]">
                  <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                  {order.customer?.name || t("orders.list.noCustomer")}
                  {order.deletedAt
                    ? ` • ${t("orders.detail.deletedAt", {
                        date: formatDateLocalized(order.deletedAt, locale),
                      })}`
                    : ""}
                </p>
                {order.deletedBy && (
                  <p className="type-micro mt-0.5 text-[var(--muted,#62685f)]">
                    {order.deletedBy}
                  </p>
                )}
              </div>
              <form action={restoreWorkOrder}>
                <input type="hidden" name="workOrderId" value={order.id} />
                <SubmitButton
                  pendingLabel={t("orders.edit.saving")}
                  className={buttonClassName({ variant: "primary", size: "sm" })}
                >
                  {t("orders.detail.restore")}
                </SubmitButton>
              </form>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
