"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  assignWorkOrderToTechnicianAction,
  type AssignmentErrorCode,
} from "@/app/assignment-actions";
import {
  WORK_ORDER_DRAG_MIME,
  WORK_ORDER_SOURCE_MIME,
  getActiveDragSource,
} from "./DraggableWorkOrder";

type DropZoneElement = "div" | "li" | "article";

function dragHasWorkOrder(event: DragEvent<HTMLElement>): boolean {
  const types = Array.from(event.dataTransfer.types);
  return (
    types.includes(WORK_ORDER_DRAG_MIME) || types.includes("text/plain")
  );
}

/**
 * Et slippmål for ett oppdragskort. Komponenten kaller den delte
 * tildelingshandlingen og viser feilen inline, slik at samme regler gjelder
 * fra dashbordet og ressursoversikten. Selve innholdet er urørt, så lenker og
 * knapper i sonen fungerer som før.
 */
export default function TechnicianDropZone({
  technicianId,
  label,
  describedBy,
  dropLabel,
  errorMessages,
  enabled = true,
  as = "div",
  className,
  children,
}: {
  technicianId: string;
  label: string;
  describedBy?: string;
  dropLabel: string;
  errorMessages: Record<AssignmentErrorCode, string>;
  enabled?: boolean;
  as?: DropZoneElement;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!enabled || pending || !dragHasWorkOrder(event)) return;

    const source = getActiveDragSource();
    // Kortet står allerede hos denne montøren; slippet ville vært en no-op.
    if (source?.fromTechnicianId === technicianId) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDragOver(false);
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragOver(false);
    if (!enabled || pending) return;

    const transfer = event.dataTransfer;
    const active = getActiveDragSource();
    const workOrderId =
      transfer.getData(WORK_ORDER_DRAG_MIME) ||
      transfer.getData("text/plain") ||
      active?.workOrderId ||
      "";
    const rawFromTechnicianId =
      transfer.getData(WORK_ORDER_SOURCE_MIME) ||
      active?.fromTechnicianId ||
      "";
    const fromTechnicianId =
      rawFromTechnicianId === "unassigned" ? "" : rawFromTechnicianId;

    if (!workOrderId || fromTechnicianId === technicianId) return;

    const formData = new FormData();
    formData.set("workOrderId", workOrderId);
    formData.set("technicianId", technicianId);
    if (fromTechnicianId) {
      formData.set("fromTechnicianId", fromTechnicianId);
    }

    setPending(true);
    setError(null);
    try {
      const result = await assignWorkOrderToTechnicianAction(formData);
      if (!result.ok) {
        setError(errorMessages[result.error]);
        return;
      }
      router.refresh();
    } catch {
      setError(errorMessages.ukjent);
    } finally {
      setPending(false);
    }
  }

  function handleDropEvent(event: DragEvent<HTMLElement>) {
    void handleDrop(event);
  }

  const Component = as;

  return (
    <Component
      data-drop-technician-id={technicianId}
      aria-label={label}
      aria-describedby={describedBy}
      aria-busy={pending || undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropEvent}
      className={`relative transition ${
        dragOver
          ? "bg-[color-mix(in_srgb,var(--signal,#d8ff3e)_18%,var(--surface,#fffdf8))] outline-2 outline-dashed outline-offset-2 outline-[var(--ink,#101310)] ring-2 ring-[var(--signal,#d8ff3e)] ring-offset-2 ring-offset-[var(--paper,#f2efe6)]"
          : ""
      } ${pending ? "opacity-70" : ""} ${className ?? ""}`}
    >
      {children}

      {dragOver && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] bg-[color-mix(in_srgb,var(--signal,#d8ff3e)_30%,transparent)] p-2"
        >
          <span className="rounded-full border-2 border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-2.5 py-1 text-center text-[11px] font-black uppercase tracking-[0.04em] text-[var(--ink,#101310)] shadow-sm">
            {dropLabel}
          </span>
        </span>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-[#e7b5ae] bg-[#fdf4f2] p-2 text-xs font-bold text-[var(--risk-text,#b42318)]"
        >
          {error}
        </p>
      )}
    </Component>
  );
}
