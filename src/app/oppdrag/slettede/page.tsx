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
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-300 pb-4">
          <h1 className="flex items-center gap-2 text-2xl md:text-3xl font-black text-gray-900">
            <Icon name="trash" className="h-6 w-6 shrink-0" />
            {t("orders.detail.deletedOrders")}
          </h1>
          <Link
            href="/oppdrag"
            className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
          >
            {t("orders.list.backToDashboard")}
          </Link>
        </div>

        <ErrorBanner message={errorKey ? t(errorKey) : undefined} />

        {restored && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 rounded-2xl border-2 border-green-200 bg-green-50 px-5 py-4 text-sm font-bold text-green-900"
          >
            <Icon name="check" className="h-4 w-4 shrink-0" />
            {t("orders.detail.restored")}
          </div>
        )}

        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-black">{t("orders.detail.deletedInfoTitle")}</p>
          <p className="mt-1">{t("orders.detail.deletedInfo")}</p>
          <p className="mt-1 text-xs font-medium">{t("orders.detail.deletedRetention")}</p>
        </div>

        {orders.length === 0 ? (
          <div className="bg-white p-8 rounded-2xl shadow-sm border-2 border-dashed border-gray-300 text-center">
            <p className="text-gray-600 font-bold">
              {t("orders.detail.noDeletedOrders")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((order) => (
              <div
                key={order.id}
                className="bg-white p-4 rounded-2xl border-2 border-gray-200 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-black text-gray-900 truncate">{order.title}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                    <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
                    {order.customer?.name || t("orders.list.noCustomer")}
                    {order.deletedAt
                      ? ` • ${t("orders.detail.deletedAt", {
                          date: formatDateLocalized(order.deletedAt, locale),
                        })}`
                      : ""}
                  </p>
                  {order.deletedBy && (
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {order.deletedBy}
                    </p>
                  )}
                </div>
                <form action={restoreWorkOrder}>
                  <input type="hidden" name="workOrderId" value={order.id} />
                  <button
                    type="submit"
                    className="bg-green-700 text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-green-800 transition shadow-sm whitespace-nowrap"
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
