import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { markdownToPlainText } from "@/lib/markdown";
import {
  addDaysUtc,
  formatDate,
  parseDateOnly,
  toDateOnly,
  todayInOslo,
} from "@/lib/dates";
import { getCurrentUser } from "@/lib/session";
import { getDefaultDepartmentId } from "@/lib/departments";
import { staffForDepartment } from "@/lib/access";
import { pageWindow, parsePage } from "@/lib/pagination";
import Pagination, { paginationLabels } from "@/components/Pagination";
import ReportHistory from "@/components/portal/ReportHistory";
import AvailabilityBoard from "@/components/portal/AvailabilityBoard";
import ContactUpdateForm from "@/components/portal/ContactUpdateForm";
import StatusBadge from "@/components/StatusBadge";
import { getPortalBookingRequests } from "@/server/portal";
import BookingForm from "./BookingForm";
import BookingRequests from "./BookingRequests";

/** Listene i kundeportalen lastes i små biter, ikke hele historikken. */
const UPCOMING_PAGE_SIZE = 20;

const WORK_ORDER_LIST_SELECT = {
  id: true,
  title: true,
  status: true,
  scheduledFor: true,
  description: true,
  technicians: { select: { name: true }, take: 10 },
} as const;

// Formaterer en dato til YYYY-MM-DD. Kalenderdatoer er UTC-midnatt i
// databasen, så vi bruker UTC og er uavhengige av serverens tidssone.
function dateKey(d: Date) {
  return toDateOnly(d);
}

export default async function KundeportalPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string; h?: string; r?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const t = await getTranslations("common");
  const listParams = await searchParams;
  const requestedUpcomingPage = parsePage(listParams.u);
  const historyPage = parsePage(listParams.h);
  const reportPage = parsePage(listParams.r);

  if (!user.isActive || user.role !== "CUSTOMER" || !user.customerId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow border text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">{t("portal.noAccessTitle")}</h1>
          <p className="text-gray-600">{t("portal.noAccessDesc")}</p>
        </div>
      </div>
    );
  }

  const customer = await prisma.customer.findFirst({
    where: { id: user.customerId, deletedAt: null },
    include: {
      department: true,
      responsibleTechnician: true,
      products: { orderBy: { model: "asc" }, take: 100 },
      contracts: { orderBy: { startDate: "desc" }, take: 50 },
    },
  });

  if (!customer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow border text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">{t("portal.noAccessTitle")}</h1>
          <p className="text-gray-600">{t("portal.noAccessDesc")}</p>
        </div>
      </div>
    );
  }

  const defaultDepartmentId = await getDefaultDepartmentId();
  const todayText = todayInOslo();

  const bookingsResult = await getPortalBookingRequests(user);
  const bookings = bookingsResult.ok ? bookingsResult.data : [];

  // Kommende oppdrag hentes med et fast tak. Avsluttede oppdrag og alle
  // rapportene deres ligger i den samlede rapporthistorikken lenger ned.
  const upcomingWhere: Prisma.WorkOrderWhereInput = {
    customerId: customer.id,
    deletedAt: null,
    status: { notIn: ["COMPLETED", "CANCELLED"] },
  };

  const upcomingTotal = await prisma.workOrder.count({ where: upcomingWhere });
  // Klem en gammel `?u=999` til siste side før listen hentes.
  const upcomingWindow = pageWindow(
    requestedUpcomingPage,
    upcomingTotal,
    UPCOMING_PAGE_SIZE,
  );
  const upcomingPage = upcomingWindow.page;
  const upcomingTotalPages = upcomingWindow.totalPages;

  const upcomingWorkOrders = await prisma.workOrder.findMany({
    where: upcomingWhere,
    orderBy: { scheduledFor: "desc" },
    take: upcomingWindow.take,
    skip: upcomingWindow.skip,
    select: WORK_ORDER_LIST_SELECT,
  });

  // Beholder motpartens side når man blar i én av listene.
  const listLink = (next: { u?: number; h?: number }, hash: string) => {
    const params = new URLSearchParams();
    const u = next.u ?? upcomingPage;
    const h = next.h ?? historyPage;
    if (u > 1) params.set("u", String(u));
    if (h > 1) params.set("h", String(h));
    if (reportPage > 1) params.set("r", String(reportPage));
    const qs = params.toString();
    return `/kundeportal${qs ? `?${qs}` : ""}${hash}`;
  };

  // --- TEKNIKERTILGJENGELIGHET: ledig/opptatt neste 7 dager ---
  // Kundeportalbrukere skal kun se tilgjengelighet, ikke hva andre kunder har bestilt.
  const today = parseDateOnly(todayText) ?? new Date();
  const horizon = addDaysUtc(today, 7);

  const days = Array.from({ length: 7 }, (_, i) => addDaysUtc(today, i));

  // Kunden ser bare montører i sin egen avdeling (faller tilbake til
  // standardavdelingen hvis kunden ikke er knyttet til en avdeling).
  const availabilityDepartmentId = customer.departmentId ?? defaultDepartmentId;

  const technicians = await prisma.user.findMany({
    where: { ...staffForDepartment(availabilityDepartmentId), isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
    take: 200,
  });

  // Hent oppdrag som overlapper de neste 7 dagene. Flerdagersoppdrag
  // (scheduledFor → scheduledTo) blokkerer alle dagene de varer.
  const scheduledWorkOrders = await prisma.workOrder.findMany({
    where: {
      departmentId: availabilityDepartmentId ?? "__ingen_avdeling__",
      deletedAt: null,
      status: { notIn: ["CANCELLED"] },
      OR: [
        { scheduledFor: { gte: today, lt: horizon } },
        { scheduledTo: { gte: today, lt: horizon } },
        {
          AND: [
            { scheduledFor: { lt: today } },
            { scheduledTo: { gte: horizon } },
          ],
        },
      ],
    },
    select: {
      scheduledFor: true,
      scheduledTo: true,
      technicians: { select: { id: true } },
    },
    take: 500,
  });

  const busyByTechnician = new Map<string, Set<string>>();
  for (const wo of scheduledWorkOrders) {
    if (!wo.scheduledFor) continue;

    // Blokker alle dager oppdraget varer (inklusiv scheduledTo).
    const start = new Date(wo.scheduledFor);
    const end = wo.scheduledTo ? new Date(wo.scheduledTo) : new Date(start);

    // Begrens til vinduet vi viser.
    const firstDay = start < today ? today : start;
    const lastDay = end > horizon ? addDaysUtc(horizon, -1) : end;

    for (const tech of wo.technicians) {
      if (!busyByTechnician.has(tech.id)) busyByTechnician.set(tech.id, new Set());
      const set = busyByTechnician.get(tech.id)!;
      for (let d = new Date(firstDay); d <= lastDay; d = addDaysUtc(d, 1)) {
        set.add(dateKey(d));
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        
        {/* HEADER */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-300 pb-4" style={{ borderBottomColor: customer.brandColor || "#2563eb" }}>
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{t("portal.headerTitle", { customerName: customer.name })}</h1>
              <p className="text-gray-500">{t("portal.headerWelcome", { userName: user.name ?? user.email ?? "" })}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/" className="bg-white text-gray-700 px-4 py-2 rounded-lg font-medium border hover:bg-gray-50 shadow-sm transition text-sm whitespace-nowrap">
              &larr; {t("portal.home")}
            </Link>
            <Link href="/kundeportal" className="bg-[var(--primary-color)] text-white px-4 py-2 rounded-lg font-bold hover:opacity-90 transition whitespace-nowrap text-sm">
              {t("portal.refresh")}
            </Link>
          </div>
        </div>

        {/* KONTAKTINFO: avdeling og ansvarlig montør */}
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200 mb-6">
          <h2 className="font-bold text-gray-900 mb-4 border-b pb-2">🏢 {t("portal.contact.title")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Avdeling / lokasjon */}
            <div className="bg-gray-50 p-3 rounded border">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                {customer.department ? t("portal.contact.department") : t("portal.contact.company")}
              </p>
              <p className="text-sm text-gray-900 font-bold">
                {customer.department?.name || customer.name}
              </p>
              {customer.department ? (
                <>
                  {(customer.department.address || customer.department.city) && (
                    <p className="text-sm text-gray-700 mt-1">
                      {customer.department.address || ""}
                      {customer.department.postalCode ? `, ${customer.department.postalCode}` : ""}
                      {customer.department.city ? ` ${customer.department.city}` : ""}
                    </p>
                  )}
                  {customer.department.phone && (
                    <p className="text-sm mt-1">
                      📞 <a href={`tel:${customer.department.phone}`} className="text-blue-600 font-bold hover:underline">{customer.department.phone}</a>
                    </p>
                  )}
                  {customer.department.email && (
                    <p className="text-sm">
                      ✉️ <a href={`mailto:${customer.department.email}`} className="text-blue-600 font-bold hover:underline">{customer.department.email}</a>
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-700 mt-1">
                    {customer.address || t("portal.contact.notProvided")} {customer.postalCode || ""} {customer.city || ""}
                  </p>
                  {customer.phone && (
                    <p className="text-sm mt-1">
                      📞 <a href={`tel:${customer.phone}`} className="text-blue-600 font-bold hover:underline">{customer.phone}</a>
                    </p>
                  )}
                  {customer.email && (
                    <p className="text-sm">
                      ✉️ <a href={`mailto:${customer.email}`} className="text-blue-600 font-bold hover:underline">{customer.email}</a>
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Ansvarlig montør */}
            <div className="bg-gray-50 p-3 rounded border">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t("portal.contact.responsible")}</p>
              {customer.responsibleTechnician ? (
                <>
                  <p className="text-sm text-gray-900 font-bold">{customer.responsibleTechnician.name}</p>
                  {customer.responsibleTechnician.phone && (
                    <p className="text-sm mt-1">
                      📞 <a href={`tel:${customer.responsibleTechnician.phone}`} className="text-blue-600 font-bold hover:underline">{customer.responsibleTechnician.phone}</a>
                    </p>
                  )}
                  {customer.responsibleTechnician.email && (
                    <p className="text-sm">
                      ✉️ <a href={`mailto:${customer.responsibleTechnician.email}`} className="text-blue-600 font-bold hover:underline">{customer.responsibleTechnician.email}</a>
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500">{t("portal.contact.noResponsible")}</p>
              )}
            </div>
          </div>

          <ContactUpdateForm />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* VENSTRE: Utstyr & Avtaler */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* Registrert utstyr */}
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200 space-y-4">
              <h2 className="font-bold text-lg text-gray-900 border-b pb-2">🔧 {t("portal.equipment.title")}</h2>
              <div className="space-y-3">
                {customer.products.length === 0 ? (
                  <p className="text-gray-500 italic text-sm">{t("portal.equipment.empty")}</p>
                ) : (
                  customer.products.map(product => (
                    <div key={product.id} className="bg-gray-50 p-3 rounded border flex justify-between items-center">
                      <div>
                        <p className="font-bold text-gray-800 text-sm">{product.model}</p>
                        <p className="text-xs text-gray-500">{t("portal.equipment.serial", { serial: product.serialNumber || "–" })}</p>
                      </div>
                      <span className="text-xs bg-white px-2 py-1 rounded text-gray-600 border">{product.location || t("portal.equipment.unknownBuilding")}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Serviceavtaler */}
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
              <h2 className="font-bold text-lg text-gray-900 border-b pb-2">📄 {t("portal.contracts.title")}</h2>
              <div className="space-y-3">
                {customer.contracts.length === 0 ? (
                  <p className="text-gray-500 italic text-sm">{t("portal.contracts.empty")}</p>
                ) : (
                  customer.contracts.map(contract => (
                    <div key={contract.id} className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold text-blue-900 text-sm">{contract.title}</p>
                        {!contract.isActive && (
                          <span className="text-xs font-bold uppercase bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded-full">
                            {t("portal.contracts.paused")}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-blue-700">
                        {t("portal.contracts.start", { date: formatDate(contract.startDate, "–") })} •{" "}
                        {t("portal.contracts.interval", { interval: t("portal.contracts.months", { count: contract.intervalMonths }) })}
                      </p>
                      <p className="text-xs text-blue-700">
                        {t("portal.contracts.next", { date: formatDate(contract.nextServiceDate, "–") })}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* HOYRE: Oppdrag & Booking */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* BOOK NYTT OPPDRAG */}
            <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
              <h2 className="font-bold text-lg text-gray-900 border-b border-gray-200 pb-2 mb-4">📅 {t("portal.booking.title")}</h2>
              <p className="text-gray-600 text-sm mb-4">{t("portal.booking.desc")}</p>
              <BookingForm
                minDate={todayText}
                defaultContactName={user.name ?? ""}
                defaultContactPhone={customer.phone ?? ""}
                equipment={customer.products.map((product) => ({
                  id: product.id,
                  label: product.serialNumber
                    ? `${product.model} · SN ${product.serialNumber}`
                    : product.model,
                }))}
              />
              <BookingRequests bookings={bookings} minDate={todayText} />
            </div>

            {/* KOMMENDE OPPDRAG */}
            <div id="kommende" className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex justify-between items-center mb-4 border-b pb-2">
                <div>
                  <h2 className="font-bold text-lg text-gray-900">📅 {t("portal.upcoming.title")}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">{t("portal.upcoming.desc")}</p>
                </div>
                <a
                  href="/api/kundeportal/export"
                  className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-200 transition whitespace-nowrap"
                >
                  ⬇️ {t("portal.upcoming.export")}
                </a>
              </div>

              {upcomingTotal === 0 ? (
                <div className="bg-gray-50 p-6 rounded-xl border border-dashed border-gray-200 text-center">
                  <p className="text-gray-500 italic text-sm">{t("portal.upcoming.empty")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingWorkOrders.map(wo => (
                    <div key={wo.id} className="bg-gray-50 p-3 rounded-xl border border-gray-200">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="font-bold text-gray-900 text-sm">{wo.title}</p>
                          <p className="text-xs text-gray-500">
                            📅 {formatDate(wo.scheduledFor, t("portal.upcoming.noDate"))}
                          </p>
                        </div>
                        <StatusBadge status={wo.status} />
                      </div>
                      <p className="text-xs text-gray-600">
                        🏢 {customer.name}
                        {wo.technicians.length > 0 && (
                          <span className="text-blue-600 font-bold ml-1">• {wo.technicians.map(t => t.name).join(", ")}</span>
                        )}
                      </p>
                      {wo.description && (
                        <p className="text-xs text-gray-700 italic mt-1">
                          {markdownToPlainText(wo.description)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <Pagination
                page={upcomingPage}
                totalPages={upcomingTotalPages}
                hrefFor={(targetPage) =>
                  listLink({ u: targetPage }, "#kommende")
                }
                labels={paginationLabels(t)}
                summary={t("portal.pagination.showing", {
                  from: (upcomingPage - 1) * UPCOMING_PAGE_SIZE + 1,
                  to: Math.min(upcomingPage * UPCOMING_PAGE_SIZE, upcomingTotal),
                  total: upcomingTotal,
                })}
                className="pt-3"
              />
            </div>

          </div>
        </div>

        <div className="mt-6">
          <ReportHistory
            page={reportPage}
            upcomingPage={upcomingPage}
            historyPage={historyPage}
          />
        </div>

        {/* TEKNIKERTILGJENGELIGHET – neste 7 dager */}
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200 mt-6">
          <div className="mb-4 border-b pb-2">
            <h2 className="font-bold text-lg text-gray-900">🗓️ {t("portal.availability.title")}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {t("portal.availability.desc")}
            </p>
          </div>

          {technicians.length === 0 ? (
            <p className="text-gray-600 italic text-sm">{t("portal.availability.empty")}</p>
          ) : (
            <AvailabilityBoard
              technicians={technicians.map((tech) => ({
                id: tech.id,
                name: tech.name ?? "",
                days: days.map((day) => ({
                  date: dateKey(day),
                  busy: busyByTechnician.get(tech.id)?.has(dateKey(day)) ?? false,
                })),
              }))}
            />
          )}
          <p className="mt-3 text-sm text-gray-700">
            {t("portal.availability.note")}
          </p>
        </div>

      </div>
    </div>
  );
}
