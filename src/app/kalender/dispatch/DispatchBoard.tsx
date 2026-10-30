"use client";

import { useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import {
  assignVisitTechniciansAction,
  unassignVisitTechnicianAction,
  updateVisitStatusAction,
} from "./actions";
import type {
  DispatchActionResult,
  DispatchDay,
  DispatchTechnician,
  DispatchVisit,
} from "./types";
import {
  WORK_ORDER_STATUS_LABEL_KEYS,
  workOrderStatusColor,
} from "@/lib/work-order-status-colors";
import {
  VISIT_STATUS_LABEL_KEYS,
} from "@/lib/visit-status";
import type { VisitStatus, WorkStatus } from "@prisma/client";

type ServerAction = (formData: FormData) => Promise<DispatchActionResult>;

const VISIT_MIME = "text/visit-id";
const TECHNICIAN_MIME = "text/technician-id";
const UNASSIGNED_LANE = "unassigned";

export default function DispatchBoard({
  days,
  technicians,
}: {
  days: DispatchDay[];
  technicians: DispatchTechnician[];
}) {
  const t = useTranslations("common");
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [dragOverLane, setDragOverLane] = useState<string | null>(null);

  function errorMessage(code: string): string {
    switch (code) {
      case "ikke-tilgang":
        return t("calendar.dispatch.rowErrorNoAccess");
      case "ugyldig-data":
        return t("calendar.dispatch.rowErrorInvalidData");
      case "visits.errors.noChange":
      case "ingen-endring":
        return t("calendar.dispatch.rowErrorNoChange");
      case "ikke-funnet":
        return t("calendar.dispatch.rowErrorNotFound");
      case "workorder-locked":
      case "visits.errors.workOrderLocked":
        return t("calendar.dispatch.rowErrorLocked");
      case "legal-hold":
      case "visits.errors.legalHold":
        return t("calendar.dispatch.rowErrorLegalHold");
      case "visits.errors.visitLocked":
        return t("calendar.dispatch.visitLockedError");
      case "visits.errors.overlap":
        return t("calendar.dispatch.visitOverlapError");
      case "visits.errors.invalidTechnician":
        return t("visits.errors.invalidTechnician");
      case "visits.errors.statusTransition":
        return t("calendar.dispatch.visitStatusError");
      case "visits.errors.invalidTimeRange":
        return t("visits.errors.invalidTimeRange");
      default:
        return t("calendar.dispatch.rowErrorUnknown");
    }
  }

  function rowIdFor(day: DispatchDay, laneKey: string, visitId: string) {
    return `${day.date}:${laneKey}:${visitId}`;
  }

  function focusRow(rowId: string) {
    requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(
        `[data-dispatch-row="${CSS.escape(rowId)}"]`,
      );
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card
        ?.querySelector<HTMLElement>("[data-dispatch-error]")
        ?.focus();
    });
  }

  async function run(
    action: ServerAction,
    visit: DispatchVisit,
    formData: FormData,
    rowId: string,
  ) {
    formData.set("visitId", visit.id);
    formData.set("workOrderId", visit.workOrderId);
    setPendingId(visit.id);
    setErrors((current) => {
      const next = { ...current };
      delete next[visit.id];
      return next;
    });

    try {
      const result = await action(formData);
      if (!result.ok) {
        setErrors((current) => ({
          ...current,
          [visit.id]: errorMessage(result.error),
        }));
        focusRow(rowId);
        return;
      }
      router.refresh();
    } catch {
      setErrors((current) => ({
        ...current,
        [visit.id]: errorMessage("ukjent"),
      }));
      focusRow(rowId);
    } finally {
      setPendingId(null);
    }
  }

  function sourceTechnicianId(event: DragEvent<HTMLDivElement>): string {
    const source = event.dataTransfer.getData(TECHNICIAN_MIME);
    return source === UNASSIGNED_LANE ? "" : source;
  }

  function draggedVisitId(event: DragEvent<HTMLDivElement>): string {
    return (
      event.dataTransfer.getData(VISIT_MIME) ||
      event.dataTransfer.getData("text/plain")
    );
  }

  function dropOnTechnician(
    event: DragEvent<HTMLDivElement>,
    day: DispatchDay,
    laneKey: string,
    technicianId: string,
  ) {
    event.preventDefault();
    setDragOverLane(null);
    const visitId = draggedVisitId(event);
    const visit = day.visits.find((candidate) => candidate.id === visitId);
    if (!visit) return;

    const fromTechnicianId = sourceTechnicianId(event);
    // Samme kolonne er en no-op; tjenesten avviser det også.
    if (fromTechnicianId === technicianId) return;

    const nextIds = new Set(visit.technicians.map((tech) => tech.id));
    if (fromTechnicianId) nextIds.delete(fromTechnicianId);
    nextIds.add(technicianId);
    if (nextIds.size === 0) return;

    const formData = new FormData();
    for (const id of nextIds) formData.append("technicianId", id);
    void run(
      assignVisitTechniciansAction,
      visit,
      formData,
      rowIdFor(day, laneKey, visit.id),
    );
  }

  function dropOnUnassigned(
    event: DragEvent<HTMLDivElement>,
    day: DispatchDay,
    laneKey: string,
  ) {
    event.preventDefault();
    setDragOverLane(null);
    const visitId = draggedVisitId(event);
    const visit = day.visits.find((candidate) => candidate.id === visitId);
    const fromTechnicianId = sourceTechnicianId(event);
    // Kort som allerede står uten montør, har ingenting å fjerne.
    if (!visit || !fromTechnicianId) return;

    const formData = new FormData();
    formData.set("technicianId", fromTechnicianId);
    void run(
      unassignVisitTechnicianAction,
      visit,
      formData,
      rowIdFor(day, laneKey, visit.id),
    );
  }

  function renderCard(
    day: DispatchDay,
    laneKey: string,
    visit: DispatchVisit,
  ) {
    const workOrderStatusLabelKey =
      WORK_ORDER_STATUS_LABEL_KEYS[visit.workOrderStatus as WorkStatus];
    const workOrderStatusLabel = workOrderStatusLabelKey
      ? t(workOrderStatusLabelKey)
      : visit.workOrderStatus;
    const visitStatusLabelKey =
      VISIT_STATUS_LABEL_KEYS[visit.visitStatus as VisitStatus];
    const visitStatusLabel = visitStatusLabelKey
      ? t(visitStatusLabelKey)
      : visit.visitStatus;
    const pending = pendingId === visit.id;
    const assignedIds = new Set(visit.technicians.map((tech) => tech.id));
    const available = technicians.filter((tech) => !assignedIds.has(tech.id));
    const fieldId = rowIdFor(day, laneKey, visit.id);

    return (
      <article
        key={fieldId}
        data-dispatch-visit={visit.id}
        data-dispatch-row={fieldId}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(VISIT_MIME, visit.id);
          event.dataTransfer.setData(
            TECHNICIAN_MIME,
            laneKey === UNASSIGNED_LANE ? UNASSIGNED_LANE : laneKey,
          );
          event.dataTransfer.setData("text/plain", visit.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          setDragOverLane(null);
        }}
        aria-busy={pending}
        className={`relative rounded-xl border bg-[var(--surface,#fffdf8)] p-3 shadow-[0_1px_2px_rgba(16,19,16,0.05)] transition ${
          pending
            ? "border-[var(--signal,#d8ff3e)] opacity-70"
            : "border-[var(--line,#dedcd1)] hover:border-[var(--ink,#101310)]"
        }`}
      >
        <div className="mb-1.5 flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{
              backgroundColor: workOrderStatusColor(visit.workOrderStatus),
            }}
          />
          <div className="min-w-0 flex-1">
            <Link
              href={`/oppdrag/${visit.workOrderId}`}
              draggable={false}
              className="block font-bold leading-tight text-[var(--ink,#101310)] decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 hover:underline"
            >
              {visit.title}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {workOrderStatusLabel !== visitStatusLabel ? (
                <span
                  title={t("calendar.dispatch.workOrderStatus")}
                  className="rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted,#62685f)]"
                >
                  {workOrderStatusLabel}
                </span>
              ) : null}
              <span className="rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ink,#101310)]">
                {visitStatusLabel}
              </span>
            </div>
          </div>
        </div>

        <p className="flex items-center gap-1.5 text-xs font-bold tabular-nums text-[var(--ink,#101310)]">
          <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
          <span>
            {visit.dateLabel} · {visit.timeLabel}
          </span>
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
          <Icon name="building" className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {visit.customerName}
            {visit.productModel ? ` · ${visit.productModel}` : ""}
          </span>
        </p>
        {visit.address && (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--muted,#62685f)]">
            <Icon name="pin" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{visit.address}</span>
          </p>
        )}
        {visit.description && (
          <p className="mt-1 line-clamp-2 text-xs italic text-[var(--muted,#62685f)]">
            {visit.description}
          </p>
        )}

        {visit.technicians.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {visit.technicians.map((tech) => (
              <button
                key={tech.id}
                type="button"
                disabled={pending}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("technicianId", tech.id);
                  void run(
                    unassignVisitTechnicianAction,
                    visit,
                    formData,
                    fieldId,
                  );
                }}
                aria-label={t("calendar.dispatch.removeTechnicianAria", {
                  name: tech.name,
                })}
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-1 text-[11px] font-bold text-[var(--ink,#101310)] transition hover:border-[var(--risk-text,#b42318)] hover:text-[var(--risk-text,#b42318)] disabled:opacity-50"
              >
                <Icon name="close" className="h-3 w-3" />
                {t("calendar.dispatch.removeTechnician", { name: tech.name })}
              </button>
            ))}
          </div>
        )}

        {available.length > 0 && (
          <form
            className="relative mt-2 flex min-w-0 items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              const selected = String(formData.get("technicianId") ?? "");
              if (!selected) return;
              const next = new FormData();
              for (const id of assignedIds) next.append("technicianId", id);
              next.append("technicianId", selected);
              void run(assignVisitTechniciansAction, visit, next, fieldId);
            }}
          >
            <label htmlFor={`assign-${fieldId}`} className="sr-only">
              {t("calendar.dispatch.assignTo")}
            </label>
            <select
              key={`assign-${fieldId}-${[...assignedIds].join(",")}`}
              id={`assign-${fieldId}`}
              name="technicianId"
              required
              defaultValue=""
              disabled={pending}
              className="min-h-8 min-w-0 max-w-full flex-1 rounded-lg border border-[var(--line,#dedcd1)] bg-white px-2 text-xs text-[var(--ink,#101310)] outline-none focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
            >
              <option value="" disabled>
                {t("calendar.dispatch.selectTechnician")}
              </option>
              {available.map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {tech.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={pending}
              className="min-h-8 rounded-lg bg-[var(--signal,#d8ff3e)] px-2.5 text-xs font-bold text-[var(--ink,#101310)] transition hover:opacity-80 disabled:opacity-50"
            >
              {t("calendar.dispatch.assign")}
            </button>
          </form>
        )}

        {visit.statusOptions.length > 0 && (
          <form
            className="relative mt-2 flex min-w-0 items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              void run(
                updateVisitStatusAction,
                visit,
                formData,
                fieldId,
              );
            }}
          >
            <label htmlFor={`status-${fieldId}`} className="sr-only">
              {t("calendar.dispatch.visitStatusFor", {
                title: visit.title,
              })}
            </label>
            <select
              key={`status-${fieldId}-${visit.visitStatus}`}
              id={`status-${fieldId}`}
              name="status"
              required
              defaultValue=""
              disabled={pending}
              className="min-h-8 min-w-0 max-w-full flex-1 rounded-lg border border-[var(--line,#dedcd1)] bg-white px-2 text-xs text-[var(--ink,#101310)] outline-none focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)]"
            >
              <option value="" disabled>
                {visitStatusLabel}
              </option>
              {visit.statusOptions.map((status) => {
                const labelKey =
                  VISIT_STATUS_LABEL_KEYS[status as VisitStatus];
                return (
                  <option key={status} value={status}>
                    {labelKey ? t(labelKey) : status}
                  </option>
                );
              })}
            </select>
            <button
              type="submit"
              disabled={pending}
              className="min-h-8 rounded-lg bg-[var(--ink,#101310)] px-2.5 text-xs font-bold text-[var(--paper,#f2efe6)] transition hover:opacity-85 disabled:opacity-50"
            >
              {t("calendar.dispatch.update")}
            </button>
          </form>
        )}

        {errors[visit.id] && (
          <p
            data-dispatch-error
            role="alert"
            tabIndex={-1}
            className="mt-2 rounded-lg border border-[#e7b5ae] bg-[#fdf4f2] p-2 text-xs font-bold text-[var(--risk-text,#b42318)] focus:outline-none focus:ring-2 focus:ring-[var(--risk,#f04427)]"
          >
            {errors[visit.id]}
          </p>
        )}

        <Link
          href={`/oppdrag/${visit.workOrderId}`}
          draggable={false}
          className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[var(--ink,#101310)] decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 hover:underline"
        >
          {t("calendar.dispatch.viewDetails")}
          <Icon name="arrowRight" className="h-3.5 w-3.5" />
        </Link>
      </article>
    );
  }

  function renderLane(day: DispatchDay, technician: DispatchTechnician | null) {
    const laneKey = technician?.id ?? UNASSIGNED_LANE;
    const laneId = `${day.date}:${laneKey}`;
    const items = technician
      ? day.visits.filter((visit) =>
          visit.technicians.some((tech) => tech.id === technician.id),
        )
      : day.visits.filter((visit) => visit.technicians.length === 0);

    return (
      <div
        key={laneId}
        data-dispatch-lane={laneKey}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDragOverLane(laneId);
        }}
        onDragLeave={() =>
          setDragOverLane((current) =>
            current === laneId ? null : current,
          )
        }
        onDrop={(event) =>
          technician
            ? dropOnTechnician(event, day, laneKey, technician.id)
            : dropOnUnassigned(event, day, laneKey)
        }
        className={`relative flex w-72 max-w-full shrink-0 flex-col rounded-xl border p-2 ${
          dragOverLane === laneId
            ? "border-[var(--ink,#101310)] bg-[color-mix(in_srgb,var(--signal,#d8ff3e)_24%,var(--surface,#fffdf8))] ring-2 ring-[var(--signal,#d8ff3e)]"
            : "border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]/70"
        }`}
      >
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2 border-b border-[var(--line,#dedcd1)] px-1 pb-2">
          <h3 className="flex min-w-0 items-center gap-1.5 truncate text-sm font-bold text-[var(--ink,#101310)]">
            <Icon
              name={technician ? "wrench" : "user"}
              className="h-4 w-4 shrink-0 text-[var(--muted,#62685f)]"
            />
            <span className="truncate">
              {technician
                ? technician.name
                : t("calendar.dispatch.unassignedLane")}
            </span>
          </h3>
          <span className="shrink-0 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-1.5 py-0.5 text-xs font-bold tabular-nums text-[var(--ink,#101310)]">
            {items.length}
          </span>
        </div>

        {!technician && (
          <p className="mb-2 flex items-start gap-1.5 px-1 text-[11px] font-medium leading-snug text-[#7a4f0c]">
            <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("calendar.dispatch.unassignDropHint")}
          </p>
        )}

        <div className="relative min-w-0 space-y-2">
          {items.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs italic text-[var(--muted,#62685f)]">
              {technician
                ? t("calendar.dispatch.dropHere", { name: technician.name })
                : t("calendar.dispatch.laneEmpty")}
            </p>
          ) : (
            items.map((visit) => renderCard(day, laneKey, visit))
          )}
        </div>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <div className="office-card p-8 text-center">
        <p className="text-sm italic text-[var(--muted,#62685f)]">
          {t("calendar.dispatch.noVisits")}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-4">
      <p
        id="dispatch-board-hint"
        className="min-w-0 break-words rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-3 py-2 text-xs font-medium text-[var(--ink,#101310)]"
      >
        <span className="flex items-start gap-2">
          <Icon name="route" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("calendar.dispatch.boardHint")}</span>
        </span>
      </p>

      {days.map((day) => (
        <section
          key={day.date}
          aria-labelledby={`dispatch-day-${day.date}`}
          className="office-card min-w-0 max-w-full p-3 sm:p-4"
        >
          <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-2">
            <div className="min-w-0">
              <h2
                id={`dispatch-day-${day.date}`}
                className="flex items-center gap-2 break-words text-lg font-black tracking-tight text-[var(--ink,#101310)]"
              >
                <Icon
                  name="calendar"
                  className="h-4 w-4 shrink-0 text-[var(--muted,#62685f)]"
                />
                {day.label}
              </h2>
            </div>
            <span className="shrink-0 rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-2 py-0.5 text-xs font-bold tabular-nums text-[var(--muted,#62685f)]">
              {t("calendar.dispatch.visitDayCount", {
                count: day.visits.length,
              })}
            </span>
          </div>

          <div className="relative flex min-w-0 max-w-full gap-3 overflow-x-auto overscroll-x-contain pb-1">
            {renderLane(day, null)}
            {technicians.map((technician) => renderLane(day, technician))}
          </div>
        </section>
      ))}
    </div>
  );
}
