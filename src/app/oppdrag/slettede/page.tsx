import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { formatDateLocalized } from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { restoreWorkOrder } from "./actions";

/**
 * Gjenoppretting av mykt slettede oppdrag. Siden er administrator-only og
 * viser bare rader som fortsatt er innenfor bevaringsperioden.
 */
export default async function DeletedWorkOrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (user.role !== "ADMIN") redirect("/oppdrag");

  const t = await getTranslations("common");
  const locale = await getLocale();

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
          <h1 className="text-2xl md:text-3xl font-black text-gray-900">
            🗑️ {t("orders.detail.deletedOrders")}
          </h1>
          <Link
            href="/oppdrag"
            className="bg-white border-2 border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm font-bold hover:bg-gray-100 transition shadow-sm whitespace-nowrap"
          >
            {t("orders.list.backToDashboard")}
          </Link>
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
                  <p className="text-xs text-gray-500 mt-1">
                    🏢 {order.customer?.name || t("orders.list.noCustomer")}
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
