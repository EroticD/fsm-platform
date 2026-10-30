import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { formatDateLocalized } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import ErrorBanner from "@/components/ErrorBanner";
import Icon from "@/components/icons";
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
    <div className="office-app min-h-screen p-4 [--focus-ring:var(--ink,#101310)] sm:p-6 md:p-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--line,#dedcd1)] pb-4 sm:flex-row sm:items-center">
          <h1 className="flex items-center gap-2 text-2xl font-black text-[var(--ink,#101310)] md:text-3xl">
            <Icon name="trash" className="h-6 w-6 shrink-0" />
            {t("orders.detail.deletedOrders")}
          </h1>
          <Link
            href="/oppdrag"
            className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-[10px] border border-[var(--line,#dedcd1)] bg-transparent px-4 py-2 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
          >
            {t("orders.list.backToDashboard")}
          </Link>
        </div>

        <ErrorBanner message={errorKey ? t(errorKey) : undefined} />

        {restored && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-2xl border border-[#b9cdb4] bg-[#eaf3e4] px-5 py-4 text-sm font-bold text-[#24502f]"
          >
            <Icon name="check" className="h-4 w-4 shrink-0" />
            {t("orders.detail.restored")}
          </div>
        )}

        <div className="rounded-2xl border border-[var(--warning-border,#fde68a)] bg-[var(--warning-surface,#fffbeb)] p-4 text-sm text-[var(--warning,#b45309)]">
          <p className="font-black">{t("orders.detail.deletedInfoTitle")}</p>
          <p className="mt-1">{t("orders.detail.deletedInfo")}</p>
          <p className="mt-1 text-xs font-medium">{t("orders.detail.deletedRetention")}</p>
        </div>

        {orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-8 text-center">
            <p className="font-bold text-[var(--muted,#62685f)]">
              {t("orders.detail.noDeletedOrders")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-black text-[var(--ink,#101310)]">{order.title}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
                    <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                    {order.customer?.name || t("orders.list.noCustomer")}
                    {order.deletedAt
                      ? ` • ${t("orders.detail.deletedAt", {
                          date: formatDateLocalized(order.deletedAt, locale),
                        })}`
                      : ""}
                  </p>
                  {order.deletedBy && (
                    <p className="mt-0.5 text-[11px] text-[var(--muted,#62685f)]">
                      {order.deletedBy}
                    </p>
                  )}
                </div>
                <form action={restoreWorkOrder}>
                  <input type="hidden" name="workOrderId" value={order.id} />
                  <button
                    type="submit"
                    className="signal-button whitespace-nowrap text-sm"
                  >
                    {t("orders.detail.restore")}
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
