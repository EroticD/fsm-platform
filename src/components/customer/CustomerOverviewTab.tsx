import Link from "next/link";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import KpiCard from "@/components/KpiCard";
import MarkdownView from "@/components/MarkdownView";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { CustomerDetailData } from "@/server/customers";
import CustomerStatusBadge from "./CustomerStatusBadge";

type OverviewProps = {
  customer: CustomerDetailData["customer"];
  customerId: string;
  office: boolean;
  totalOrders: number;
  activeOrders: number;
  completedOrders: number;
  reportCount: number;
  nextOrder: CustomerDetailData["nextOrder"];
  portalUserCount: number;
  recentOrders: CustomerDetailData["recentOrders"];
  recentLogs: CustomerDetailData["recentLogs"];
};

export default function CustomerOverviewTab({
  customer,
  customerId,
  office,
  totalOrders,
  activeOrders,
  completedOrders,
  reportCount,
  nextOrder,
  portalUserCount,
  recentOrders,
  recentLogs,
}: OverviewProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon="📂" label="Oppdrag totalt" value={totalOrders} tone="gray" href="?tab=oppdrag" />
        <KpiCard icon="🔄" label="Aktive oppdrag" value={activeOrders} tone="blue" href="?tab=oppdrag" />
        <KpiCard icon="✅" label="Fullførte" value={completedOrders} tone="green" href="?tab=oppdrag" />
        <KpiCard icon="📋" label="Utfylte sjekklister" value={reportCount} tone="amber" href="?tab=oppdrag" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon="🔧" label="Enheter" value={customer._count.products} tone="gray" href="?tab=enheter" />
        <KpiCard icon="👤" label="Kontaktpersoner" value={customer._count.contacts} tone="gray" href="?tab=kontakter" />
        <KpiCard icon="📄" label="Serviceavtaler" value={customer._count.contracts} tone="blue" href="?tab=avtaler" />
        <KpiCard icon="📎" label="Vedlegg" value={customer._count.attachments} tone="gray" href="?tab=vedlegg" />
        {office && (
          <KpiCard icon="🔐" label="Portalbrukere" value={portalUserCount} tone="gray" href="?tab=portal" />
        )}
        <KpiCard
          icon="🗓️"
          label="Neste oppdrag"
          value={nextOrder ? formatDate(nextOrder.scheduledFor, "Ingen dato") : "Ingen"}
          sub={nextOrder?.title}
          tone="blue"
          href="?tab=oppdrag"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bedriftsinformasjon */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-4 lg:col-span-1">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-black text-gray-900 text-base">🏢 Bedriftsinformasjon</h2>
            {office && (
              <Link href={`/kunder/${customerId}/rediger`} className="text-[11px] font-bold text-blue-600 hover:underline">
                Endre
              </Link>
            )}
          </div>
          <div className="text-sm space-y-3 text-gray-800">
            <p><strong>Adresse:</strong><br />
              <GoogleMapsLink
                address={customer.address}
                postalCode={customer.postalCode}
                city={customer.city}
                label={customer.address || "Ikke oppgitt"}
              />
              <br />
              {customer.postalCode || ""} {customer.city || ""}
            </p>
            <p><strong>Telefon:</strong><br />{customer.phone ? <a href={`tel:${customer.phone}`} className="text-blue-600 font-bold hover:underline">{customer.phone}</a> : "Ikke oppgitt"}</p>
            <p><strong>E-post:</strong><br />{customer.email ? <a href={`mailto:${customer.email}`} className="text-blue-600 font-bold hover:underline">{customer.email}</a> : "Ikke oppgitt"}</p>
            <p><strong>Avdeling:</strong><br />{customer.department?.name || "Ikke tilknyttet"}</p>
            <p><strong>Ansvarlig montør:</strong><br />{customer.responsibleTechnician?.name || "Ikke satt"}</p>
            {customer.notes && (
              <div>
                <strong>Notat:</strong>
                <div className="text-gray-600 mt-0.5">
                  <MarkdownView value={customer.notes} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Siste oppdrag */}
        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200 space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="font-black text-gray-900 text-base">📂 Siste oppdrag</h2>
            <Link href="?tab=oppdrag" className="text-[11px] font-bold text-blue-600 hover:underline">
              Se alle ({totalOrders})
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <p className="text-xs text-gray-500 italic">Ingen oppdrag registrert ennå.</p>
          ) : (
            <div className="space-y-2">
              {recentOrders.map((wo) => (
                <Link
                  key={wo.id}
                  href={`/oppdrag/${wo.id}`}
                  className="block bg-gray-50 hover:bg-blue-50/60 border border-gray-200 hover:border-blue-300 p-3 rounded-xl transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-gray-900 text-sm truncate">{wo.title}</span>
                    <CustomerStatusBadge status={wo.status} />
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {formatDate(wo.scheduledFor, "Ingen dato")}
                    {wo._count.reports > 0 ? ` • 📋 ${wo._count.reports} sjekkliste(r)` : ""}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Siste aktivitet */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border-2 border-gray-200">
        <div className="flex items-center justify-between border-b pb-2 mb-3">
          <h2 className="font-black text-gray-900 text-base">📋 Siste aktivitet</h2>
          <Link href="?tab=aktivitet" className="text-[11px] font-bold text-blue-600 hover:underline">
            Se all aktivitet
          </Link>
        </div>
        {recentLogs.length === 0 ? (
          <p className="text-xs text-gray-500 italic">Ingen aktivitet registrert.</p>
        ) : (
          <ol className="space-y-2">
            {recentLogs.map((log) => (
              <li key={log.id} className="flex items-start gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-gray-800 font-medium">{log.action}</p>
                  <p className="text-[10px] text-gray-500">
                    {log.userName || "Ukjent"} • {formatDateTime(log.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
