"use client";

import { useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import ConfirmSubmitForm from "@/components/ConfirmSubmitForm";
import {
  assignTechnicianAction,
  moveTechnicianAction,
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

const WORK_ORDER_MIME = "text/work-order-id";
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
      case "ugyldig-status":
        return t("calendar.dispatch.invalidStatus");
      case "ikke-tilgang":
        return t("calendar.dispatch.rowErrorNoAccess");
      case "ugyldig-data":
        return t("calendar.dispatch.rowErrorInvalidData");
      case "ingen-endring":
        return t("calendar.dispatch.rowErrorNoChange");
      case "ikke-funnet":
        return t("calendar.dispatch.rowErrorNotFound");
      case "workorder-locked":
        return t("calendar.dispatch.rowErrorLocked");
      case "legal-hold":
        return t("calendar.dispatch.rowErrorLegalHold");
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

  function sourceTechnicianId(event: DragEvent<HTMLDivElement>): string {
    const source = event.dataTransfer.getData(TECHNICIAN_MIME);
    return source === UNASSIGNED_LANE ? "" : source;
  }

  function draggedWorkOrderId(event: DragEvent<HTMLDivElement>): string {
    return (
      event.dataTransfer.getData(WORK_ORDER_MIME) ||
      event.dataTransfer.getData("text/plain")
    );
  }

  function dropOnTechnician(
    event: DragEvent<HTMLDivElement>,
    technicianId: string,
  ) {
    event.preventDefault();
    setDragOverLane(null);
    const workOrderId = draggedWorkOrderId(event);
    if (!workOrderId) return;

    const fromTechnicianId = sourceTechnicianId(event);
    // Samme kolonne er en no-op; serveren avviser det også.
    if (fromTechnicianId === technicianId) return;

    const formData = new FormData();
    formData.set("fromTechnicianId", fromTechnicianId);
    formData.set("technicianId", technicianId);
    void run(moveTechnicianAction, workOrderId, formData);
  }

  function dropOnUnassigned(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOverLane(null);
    const workOrderId = draggedWorkOrderId(event);
    const fromTechnicianId = sourceTechnicianId(event);
    // Kort som allerede står uten montør, har ingenting å fjerne.
    if (!workOrderId || !fromTechnicianId) return;

    const formData = new FormData();
    formData.set("fromTechnicianId", fromTechnicianId);
    void run(moveTechnicianAction, workOrderId, formData);
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
          event.dataTransfer.setData(WORK_ORDER_MIME, workOrder.id);
          event.dataTransfer.setData(
            TECHNICIAN_MIME,
            laneKey === UNASSIGNED_LANE ? UNASSIGNED_LANE : laneKey,
          );
          event.dataTransfer.setData("text/plain", workOrder.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          setDragOverLane(null);
        }}
        aria-busy={pending}
        className={`relative rounded-xl border bg-white p-3 shadow-sm transition ${
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
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600">
                {statusLabel}
              </span>
              {workOrder.isOverdue && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900">
                  {t("calendar.dispatch.overdue")}
                </span>
              )}
            </div>
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
            className="relative mt-2 flex min-w-0 items-center gap-1.5"
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
              className="min-h-8 min-w-0 max-w-full flex-1 rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-900 focus:ring-2 focus:ring-blue-600"
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
            className="relative mt-2 flex min-w-0 items-center gap-1.5"
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
              className="min-h-8 min-w-0 max-w-full flex-1 rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-900 focus:ring-2 focus:ring-blue-600"
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

        {workOrder.canComplete && (
          <ConfirmSubmitForm
            action={(formData) =>
              run(updateStatusAction, workOrder.id, formData, fieldId)
            }
            confirmMessage={t("orders.detail.completeConfirm")}
            confirmLabel={t("orders.detail.stickyComplete")}
            className="mt-2 flex min-w-0 items-center gap-1.5"
          >
            <input type="hidden" name="status" value="COMPLETED" />
            <button
              type="submit"
              disabled={pending}
              className="min-h-8 w-full rounded-lg border border-green-200 bg-green-50 px-2.5 text-xs font-bold text-green-800 hover:bg-green-100 disabled:opacity-50"
            >
              ✅ {t("orders.detail.stickyComplete")}
            </button>
          </ConfirmSubmitForm>
        )}

        {workOrder.canCancel && (
          <ConfirmSubmitForm
            action={(formData) =>
              run(updateStatusAction, workOrder.id, formData, fieldId)
            }
            confirmMessage={t("orders.detail.cancelConfirm")}
            confirmLabel={t("orders.detail.cancelWorkOrder")}
            danger
            className="mt-2 flex min-w-0 items-center gap-1.5"
          >
            <input type="hidden" name="status" value="CANCELLED" />
            <button
              type="submit"
              disabled={pending}
              className="min-h-8 w-full rounded-lg border border-red-200 bg-red-50 px-2.5 text-xs font-bold text-red-800 hover:bg-red-100 disabled:opacity-50"
            >
              {t("orders.detail.cancelWorkOrder")}
            </button>
          </ConfirmSubmitForm>
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
    const laneKey = technician?.id ?? UNASSIGNED_LANE;
    const laneId = `${day.date}:${laneKey}`;
    const items = technician
      ? day.workOrders.filter((workOrder) =>
          workOrder.technicians.some((tech) => tech.id === technician.id),
        )
      : day.workOrders.filter(
          (workOrder) => workOrder.technicians.length === 0,
        );
    // Datokolonnene tar alltid imot kort. «Uten montør» er også et bevisst
    // slippmål: det fjerner kilden montør, men aldri flere montører samtidig.
    const isDropTarget = true;

    return (
      <div
        key={laneId}
        data-dispatch-lane={laneKey}
        onDragOver={
          isDropTarget
            ? (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
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
          isDropTarget
            ? (event) =>
                technician
                  ? dropOnTechnician(event, technician.id)
                  : dropOnUnassigned(event)
            : undefined
        }
        className={`relative flex w-72 max-w-full shrink-0 flex-col rounded-xl border p-2 ${
          isDropTarget && dragOverLane === laneId
            ? "border-blue-500 bg-blue-50 ring-2 ring-blue-300"
            : "border-gray-200 bg-gray-50"
        }`}
      >
        <div className="mb-2 flex min-w-0 items-center justify-between gap-2 border-b border-gray-200 px-1 pb-2">
          <h3 className="min-w-0 truncate text-sm font-bold text-gray-900">
            {technician ? `👷 ${technician.name}` : t("calendar.dispatch.unassignedLane")}
          </h3>
          <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-xs font-bold text-gray-700">
            {items.length}
          </span>
        </div>

        {!technician && (
          <p className="mb-2 px-1 text-[11px] font-medium leading-snug text-amber-800">
            {t("calendar.dispatch.unassignDropHint")}
          </p>
        )}

        <div className="relative min-w-0 space-y-2">
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
    <div className="min-w-0 max-w-full space-y-4">
      <p
        id="dispatch-board-hint"
        className="min-w-0 break-words rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-900"
      >
        {t("calendar.dispatch.boardHint")}
      </p>

      {days.map((day) => (
        <section
          key={day.date}
          aria-labelledby={`dispatch-day-${day.date}`}
          className={`min-w-0 max-w-full rounded-2xl border bg-white p-3 shadow-sm sm:p-4 ${
            day.kind === "attention"
              ? "border-2 border-amber-300 bg-amber-50/40"
              : "border-gray-200"
          }`}
        >
          <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 pb-2">
            <div className="min-w-0">
              <h2
                id={`dispatch-day-${day.date}`}
                className={`break-words text-lg font-bold ${
                  day.kind === "attention"
                    ? "text-amber-900"
                    : "text-gray-900"
                }`}
              >
                {day.kind === "attention" ? "⚠️" : "📅"} {day.label}
              </h2>
              {day.kind === "attention" && (
                <p className="mt-1 text-xs font-medium text-amber-800">
                  {t("calendar.dispatch.attentionHint")}
                </p>
              )}
            </div>
            <span className="shrink-0 text-xs font-bold text-gray-600">
              {t("calendar.dispatch.dayCount", {
                count: day.workOrders.length,
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
