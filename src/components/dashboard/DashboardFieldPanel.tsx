import Link from "next/link";

import Icon from "@/components/icons";
import WorkOrderMap, {
  type TechnicianMapPoint,
} from "@/components/WorkOrderMap";
import { formatDateLocalized } from "@/lib/dates";
import {
  FIELD_STATUS_LABEL_KEYS,
  type FieldStatusKey,
  type FieldStatusRow,
} from "@/lib/dashboard-field-status";
import type { MapSettings } from "@/server/map-settings";
import FieldStatusBadge from "./FieldStatusBadge";

export type DashboardFieldMarker = {
  visitId: string;
  userId: string;
  name: string;
  status: string;
  updatedAt: Date;
  lat: number;
  lng: number;
  workOrderId: string;
  workOrderTitle: string;
  customerName: string | null;
};

type Translator = (key: string, values?: Record<string, string | number>) => string;

function timeLabel(value: Date, locale: string): string {
  return formatDateLocalized(value, locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function statusLabel(status: string, t: Translator): string {
  const key = FIELD_STATUS_LABEL_KEYS[status as FieldStatusKey];
  return key ? t(key) : status;
}

/**
 * Kompakt liveflate for kontordashbordet: dagens status per montør og et
 * kart over montører som deler posisjon nå.
 *
 * Komponenten er en serverkomponent. Kartet er en klientkomponent, men får
 * bare ferdig sjekkede punkter fra tjenestelaget. Alle markørene finnes også
 * som vanlige lenker i listen under, slik at kartet aldri er eneste vei til
 * informasjonen.
 */
export default function DashboardFieldPanel({
  rows,
  markers,
  trackingEnabled,
  settings,
  updatedAt,
  locale,
  t,
}: {
  rows: FieldStatusRow[];
  markers: DashboardFieldMarker[];
  trackingEnabled: boolean;
  settings: MapSettings;
  updatedAt: Date;
  locale: string;
  t: Translator;
}) {
  const active = rows.filter(
    (row) => row.status === "ON_SITE" || row.status === "EN_ROUTE",
  ).length;
  const technicians = rows.filter((row) => row.status !== "ABSENT").length;

  const technicianPoints: TechnicianMapPoint[] = markers.map((marker) => ({
    id: `${marker.visitId}:${marker.userId}`,
    name: marker.name || t("dashboard.unknownUser"),
    status: statusLabel(marker.status, t),
    updatedAt: timeLabel(marker.updatedAt, locale),
    lat: marker.lat,
    lng: marker.lng,
    href: `/oppdrag/${marker.workOrderId}`,
    linkLabel: t("dashboard.field.openWorkOrder"),
  }));

  const hasMarkers = technicianPoints.length > 0;

  return (
    <section
      aria-labelledby="dashboard-field-title"
      className="office-card overflow-hidden"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line,#dedcd1)] px-4 py-3">
        <div className="min-w-0">
          <h2
            id="dashboard-field-title"
            className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-[var(--ink,#101310)]"
          >
            <Icon name="users" className="h-4 w-4 shrink-0" />
            {t("dashboard.field.title")}
          </h2>
          <p className="mt-1 text-xs font-bold text-[var(--muted,#62685f)]">
            {t("dashboard.field.summary", {
              active,
              total: technicians,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-2xs font-black uppercase tracking-[0.08em] text-[var(--muted,#62685f)]">
            {t("dashboard.field.updatedAt", {
              time: timeLabel(updatedAt, locale),
            })}
          </span>
          <Link
            href="/kart"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--ink,#101310)] px-3 py-1 text-2xs font-black text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
          >
            {t("dashboard.field.openMap")}
            <Icon name="arrowRight" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-b border-[var(--line,#dedcd1)] lg:border-b-0 lg:border-r">
          {rows.length === 0 ? (
            <p className="px-4 py-5 text-sm font-medium text-[var(--muted,#62685f)]">
              {t("dashboard.field.noStaff")}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--line,#dedcd1)]">
              {rows.map((row) => (
                <li key={row.userId} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-bold text-[var(--ink,#101310)]">
                        {row.name || t("dashboard.unknownUser")}
                      </span>
                      <FieldStatusBadge status={row.status} t={t} />
                    </div>
                    {row.lastPositionAt ? (
                      <span className="text-2xs font-bold tabular-nums text-[var(--muted,#62685f)]">
                        {t("dashboard.field.lastShared", {
                          time: timeLabel(row.lastPositionAt, locale),
                        })}
                      </span>
                    ) : (
                      <span className="text-2xs font-medium text-[var(--muted,#62685f)]">
                        {t("dashboard.field.noPosition")}
                      </span>
                    )}
                  </div>

                  {row.visit ? (
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--muted,#62685f)]">
                      <Link
                        href={`/oppdrag/${row.visit.workOrderId}`}
                        className="min-w-0 truncate font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                      >
                        {row.visit.title}
                      </Link>
                      <span aria-hidden>·</span>
                      <span className="truncate">
                        {row.visit.customerName ||
                          t("dashboard.orderList.noCustomer")}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-0.5 text-xs text-[var(--muted,#62685f)]">
                      {t("dashboard.field.noVisit")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 p-3 sm:p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-2xs font-black uppercase tracking-[0.12em] text-[var(--muted,#62685f)]">
              <Icon name="map" className="h-3.5 w-3.5" />
              {t("dashboard.field.mapTitle")}
            </h3>
          </div>

          {!trackingEnabled ? (
            <div className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4">
              <p className="text-sm font-bold text-[var(--ink,#101310)]">
                {t("dashboard.field.trackingDisabled")}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-[var(--muted,#62685f)]">
                <li>{t("dashboard.field.trackingDisabledHint")}</li>
                <li>{t("dashboard.field.trackingDisabledShareHint")}</li>
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Link
                  href="/innstillinger?tab=avdelinger"
                  className="inline-flex min-h-9 items-center gap-1.5 text-xs font-black text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                >
                  {t("dashboard.field.openDepartmentSettings")}
                  <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/mine-oppdrag"
                  className="inline-flex min-h-9 items-center gap-1.5 text-xs font-black text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                >
                  {t("dashboard.field.openMyAssignments")}
                  <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ) : !hasMarkers ? (
            <div className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-4">
              <p className="text-sm font-bold text-[var(--ink,#101310)]">
                {t("dashboard.field.mapEmpty")}
              </p>
              <p className="mt-1 text-xs text-[var(--muted,#62685f)]">
                {t("dashboard.field.mapEmptyHint")}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Link
                  href="/mine-oppdrag"
                  className="inline-flex min-h-9 items-center gap-1.5 text-xs font-black text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                >
                  {t("dashboard.field.openMyAssignments")}
                  <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/kart"
                  className="inline-flex min-h-9 items-center gap-1.5 text-xs font-black text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                >
                  {t("dashboard.field.openMap")}
                  <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ) : (
            <WorkOrderMap
              points={[]}
              technicians={technicianPoints}
              listId="dashboard-field-map-list"
              listHint={t("dashboard.field.mapListHint")}
              ariaLabel={t("dashboard.field.mapAria")}
              noPointsLabel={t("dashboard.field.mapEmpty")}
              openLabel={t("dashboard.field.openWorkOrder")}
              mapClassName="z-0 h-[280px] w-full overflow-hidden rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] sm:h-[340px]"
              layerLabels={{
                osm: t("p3.map.layers.osm"),
                topo: t("p3.map.layers.topo"),
                light: t("p3.map.layers.light"),
                satellite: t("p3.map.layers.satellite"),
              }}
              settings={settings}
            />
          )}

          {hasMarkers ? (
            <div className="mt-3" id="dashboard-field-map-list">
              <p className="sr-only">{t("dashboard.field.mapListTitle")}</p>
              <ul className="space-y-1.5">
                {markers.map((marker) => (
                  <li
                    key={`${marker.visitId}:${marker.userId}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-[var(--ink,#101310)]">
                        {marker.name || t("dashboard.unknownUser")}{" "}
                        <span className="font-medium text-[var(--muted,#62685f)]">
                          · {statusLabel(marker.status, t)}
                        </span>
                      </p>
                      <p className="truncate text-2xs text-[var(--muted,#62685f)]">
                        {marker.workOrderTitle}
                        {marker.customerName ? ` · ${marker.customerName}` : ""}
                      </p>
                      <p className="text-2xs font-bold tabular-nums text-[var(--muted,#62685f)]">
                        {t("dashboard.field.markerUpdated", {
                          time: timeLabel(marker.updatedAt, locale),
                        })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/oppdrag/${marker.workOrderId}`}
                        className="text-2xs font-black text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                      >
                        {t("dashboard.field.openWorkOrder")}
                      </Link>
                      <Link
                        href={`/kart?technician=${encodeURIComponent(marker.userId)}`}
                        className="text-2xs font-bold text-[var(--muted,#62685f)] underline underline-offset-4"
                      >
                        {t("dashboard.field.openMap")}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
