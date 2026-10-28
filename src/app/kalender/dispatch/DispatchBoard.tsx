"use client";

import { useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  assignTechnicianAction,
  unassignTechnicianAction,
  updateStatusAction,
} from "./actions";
import type {
  DispatchActionResult,
  DispatchDay,
  DispatchTechnician,
  DispatchWorkOrder,
} from "./types";
import {
  WORK_ORDER_STATUS_LABEL_KEYS,
  workOrderStatusColor,
} from "@/lib/work-order-status-colors";
import type { WorkStatus } from "@prisma/client";

type ServerAction = (formData: FormData) => Promise<DispatchActionResult>;

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
      case "ugyldig-status":
        return t("calendar.dispatch.invalidStatus");
      case "ikke-tilgang":
        return t("calendar.dispatch.rowErrorNoAccess");
      case "ugyldig-data":
        return t("calendar.dispatch.rowErrorInvalidData");
      case "ikke-funnet":
        return t("calendar.dispatch.rowErrorNotFound");
      default:
        return t("calendar.dispatch.rowErrorUnknown");
    }
  }

  function focusRow(workOrderId: string, rowId?: string) {
    requestAnimationFrame(() => {
      const selector = rowId
        ? `[data-dispatch-row="${CSS.escape(rowId)}"]`
        : `[data-dispatch-work-order="${CSS.escape(workOrderId)}"]`;
      const card = document.querySelector<HTMLElement>(selector);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card
        ?.querySelector<HTMLElement>("[data-dispatch-error]")
        ?.focus();
    });
  }

  async function run(
    action: ServerAction,
    workOrderId: string,
    formData: FormData,
    rowId?: string,
  ) {
    formData.set("workOrderId", workOrderId);
    setPendingId(workOrderId);
    setErrors((current) => {
      const next = { ...current };
      delete next[workOrderId];
      return next;
    });

    try {
      const result = await action(formData);
      if (!result.ok) {
        setErrors((current) => ({
          ...current,
          [workOrderId]: errorMessage(result.error),
        }));
        focusRow(workOrderId, rowId);
        return;
      }
      router.refresh();
    } catch {
      setErrors((current) => ({
        ...current,
        [workOrderId]: errorMessage("ukjent"),
      }));
      focusRow(workOrderId, rowId);
    } finally {
      setPendingId(null);
    }
  }

  function dropOnTechnician(
    event: DragEvent<HTMLDivElement>,
    technicianId: string,
  ) {
    event.preventDefault();
    setDragOverLane(null);
    const workOrderId =
      event.dataTransfer.getData("text/work-order-id") ||
      event.dataTransfer.getData("text/plain");
    if (!workOrderId) return;

    const formData = new FormData();
    formData.set("technicianId", technicianId);
    void run(assignTechnicianAction, workOrderId, formData);
  }

  function renderCard(
    day: DispatchDay,
    laneKey: string,
    workOrder: DispatchWorkOrder,
  ) {
    const statusLabelKey =
      WORK_ORDER_STATUS_LABEL_KEYS[workOrder.status as WorkStatus];
    const statusLabel = statusLabelKey
      ? t(statusLabelKey)
      : workOrder.status;
    const pending = pendingId === workOrder.id;
    const assignedIds = new Set(workOrder.technicians.map((tech) => tech.id));
    const available = technicians.filter((tech) => !assignedIds.has(tech.id));
    const fieldId = `${day.date}-${laneKey}-${workOrder.id}`;

    return (
      <article
        key={fieldId}
        data-dispatch-work-order={workOrder.id}
        data-dispatch-row={fieldId}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/work-order-id", workOrder.id);
          event.dataTransfer.setData("text/plain", workOrder.id);
          event.dataTransfer.effectAllowed = "copy";
        }}
        aria-busy={pending}
        className={`rounded-xl border bg-white p-3 shadow-sm transition ${
          pending
            ? "border-blue-400 opacity-70"
            : "border-gray-200 hover:border-blue-300"
        }`}
      >
        <div className="mb-1.5 flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: workOrderStatusColor(workOrder.status) }}
          />
          <div className="min-w-0 flex-1">
            <Link
              href={`/oppdrag/${workOrder.id}`}
              draggable={false}
              className="block font-bold leading-tight text-gray-900 hover:text-blue-700 hover:underline"
            >
              {workOrder.title}
            </Link>
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600">
              {statusLabel}
            </span>
          </div>
        </div>

        <p className="text-xs text-gray-600">
          🏢 {workOrder.customerName}
          {workOrder.productModel ? ` · ${workOrder.productModel}` : ""}
        </p>
        {workOrder.address && (
          <p className="text-xs text-gray-500">📍 {workOrder.address}</p>
        )}
        {workOrder.dateRange && (
          <p className="text-xs text-gray-500">📅 {workOrder.dateRange}</p>
        )}
        {workOrder.description && (
          <p className="mt-1 line-clamp-2 text-xs italic text-gray-700">
            {workOrder.description}
          </p>
        )}

        {workOrder.technicians.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {workOrder.technicians.map((tech) => (
              <button
                key={tech.id}
                type="button"
                disabled={pending}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("technicianId", tech.id);
                  void run(
                    unassignTechnicianAction,
                    workOrder.id,
                    formData,
                    fieldId,
                  );
                }}
                aria-label={t("calendar.dispatch.removeTechnicianAria", {
                  name: tech.name,
                })}
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-800 hover:bg-red-100 disabled:opacity-50"
              >
                ✕ {t("calendar.dispatch.removeTechnician", { name: tech.name })}
              </button>
            ))}
          </div>
        )}

        {available.length > 0 && (
          <form
            className="mt-2 flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              void run(assignTechnicianAction, workOrder.id, formData, fieldId);
            }}
          >
            <label
              htmlFor={`assign-${fieldId}`}
              className="sr-only"
            >
              {t("calendar.dispatch.assignTo")}
            </label>
            <select
              key={`assign-${fieldId}-${[...assignedIds].join(",")}`}
              id={`assign-${fieldId}`}
              name="technicianId"
              required
              defaultValue=""
              disabled={pending}
              className="min-h-8 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-900 focus:ring-2 focus:ring-blue-600"
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
              className="min-h-8 rounded-lg bg-[var(--primary-color)] px-2.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              {t("calendar.dispatch.assign")}
            </button>
          </form>
        )}

        {workOrder.statusOptions.length > 0 && (
          <form
            className="mt-2 flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData(event.currentTarget);
              void run(updateStatusAction, workOrder.id, formData, fieldId);
            }}
          >
            <label
              htmlFor={`status-${fieldId}`}
              className="sr-only"
            >
              {t("calendar.dispatch.statusFor", { title: workOrder.title })}
            </label>
            <select
              key={`status-${fieldId}-${workOrder.status}`}
              id={`status-${fieldId}`}
              name="status"
              required
              defaultValue=""
              disabled={pending}
              className="min-h-8 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-900 focus:ring-2 focus:ring-blue-600"
            >
              <option value="" disabled>
                {statusLabel}
              </option>
              {workOrder.statusOptions.map((status) => {
                const labelKey =
                  WORK_ORDER_STATUS_LABEL_KEYS[status as WorkStatus];
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
              className="min-h-8 rounded-lg bg-gray-900 px-2.5 text-xs font-bold text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {t("calendar.dispatch.update")}
            </button>
          </form>
        )}

        {errors[workOrder.id] && (
          <p
            data-dispatch-error
            role="alert"
            tabIndex={-1}
            className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs font-bold text-red-800 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {errors[workOrder.id]}
          </p>
        )}

        <Link
          href={`/oppdrag/${workOrder.id}`}
          draggable={false}
          className="mt-2 inline-block text-xs font-bold text-blue-700 hover:underline"
        >
          {t("calendar.dispatch.viewDetails")}
        </Link>
      </article>
    );
  }

  function renderLane(day: DispatchDay, technician: DispatchTechnician | null) {
    const laneKey = technician?.id ?? "unassigned";
    const laneId = `${day.date}:${laneKey}`;
    const items = technician
      ? day.workOrders.filter((workOrder) =>
          workOrder.technicians.some((tech) => tech.id === technician.id),
        )
      : day.workOrders.filter(
          (workOrder) => workOrder.technicians.length === 0,
        );
    const isDropTarget = Boolean(technician);

    return (
      <div
        key={laneId}
        onDragOver={
          isDropTarget
            ? (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setDragOverLane(laneId);
              }
            : undefined
        }
        onDragLeave={
          isDropTarget
            ? () => setDragOverLane((current) => (current === laneId ? null : current))
            : undefined
        }
        onDrop={
          isDropTarget && technician
            ? (event) => dropOnTechnician(event, technician.id)
            : undefined
        }
        className={`flex w-72 shrink-0 flex-col rounded-xl border p-2 ${
          isDropTarget && dragOverLane === laneId
            ? "border-blue-500 bg-blue-50 ring-2 ring-blue-300"
            : "border-gray-200 bg-gray-50"
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-2 border-b border-gray-200 px-1 pb-2">
          <h3 className="truncate text-sm font-bold text-gray-900">
            {technician ? `👷 ${technician.name}` : t("calendar.dispatch.unassignedLane")}
          </h3>
          <span className="rounded bg-white px-1.5 py-0.5 text-xs font-bold text-gray-700">
            {items.length}
          </span>
        </div>

        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="px-1 py-4 text-center text-xs italic text-gray-500">
              {technician
                ? t("calendar.dispatch.dropHere", { name: technician.name })
                : t("calendar.dispatch.laneEmpty")}
            </p>
          ) : (
            items.map((workOrder) => renderCard(day, laneKey, workOrder))
          )}
        </div>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <p className="italic text-gray-600">{t("calendar.dispatch.empty")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p
        id="dispatch-board-hint"
        className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900"
      >
        {t("calendar.dispatch.boardHint")}
      </p>

      {days.map((day) => (
        <section
          key={day.date}
          aria-labelledby={`dispatch-day-${day.date}`}
          className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4"
        >
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 pb-2">
            <h2
              id={`dispatch-day-${day.date}`}
              className="text-lg font-bold text-gray-900"
            >
              📅 {day.label}
            </h2>
            <span className="text-xs font-bold text-gray-600">
              {t("calendar.dispatch.dayCount", {
                count: day.workOrders.length,
              })}
            </span>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-1">
            {renderLane(day, null)}
            {technicians.map((technician) => renderLane(day, technician))}
          </div>
        </section>
      ))}
    </div>
  );
}
