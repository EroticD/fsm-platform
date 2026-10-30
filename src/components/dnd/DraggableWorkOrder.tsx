"use client";

import {
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

export const WORK_ORDER_DRAG_MIME = "text/work-order-id";
export const WORK_ORDER_SOURCE_MIME = "text/from-technician-id";

type ActiveDragSource = {
  workOrderId: string;
  fromTechnicianId: string;
};

let activeDragSource: ActiveDragSource | null = null;

/**
 * Kilden til draget mens det pågår. DataTransfer er ikke lesbar under
 * `dragover` i alle nettlesere, så slippsonen bruker denne for å unngå å lyse
 * opp når kortet allerede står hos samme montør.
 */
export function getActiveDragSource(): ActiveDragSource | null {
  return activeDragSource;
}

function startsOnControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("button, select, input, textarea, [contenteditable='true']"),
  );
}

/**
 * Gjør et helt kort dragbart uten å ta over klikk på lenker eller knapper.
 * Interaktive kontroller inne i kortet starter ikke et drag; da kan de brukes
 * som før også på berøringsskjermer og med tastatur.
 */
export default function DraggableWorkOrder({
  workOrderId,
  fromTechnicianId,
  label,
  disabled = false,
  className,
  children,
}: {
  workOrderId: string;
  fromTechnicianId?: string | null;
  label: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  // Nettleseren bruker nærmeste dragbare forelder som dragstart-mål, så vi må
  // huske hvor pekeren faktisk startet for å skåne knapper og skjemafelt.
  const startedOnControl = useRef(false);
  const sourceTechnicianId = fromTechnicianId || "";

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    startedOnControl.current = startsOnControl(event.target);
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    if (
      disabled ||
      startedOnControl.current ||
      startsOnControl(event.target)
    ) {
      event.preventDefault();
      return;
    }

    activeDragSource = {
      workOrderId,
      fromTechnicianId: sourceTechnicianId,
    };
    event.dataTransfer.setData(WORK_ORDER_DRAG_MIME, workOrderId);
    if (sourceTechnicianId) {
      event.dataTransfer.setData(WORK_ORDER_SOURCE_MIME, sourceTechnicianId);
    }
    event.dataTransfer.setData("text/plain", workOrderId);
    event.dataTransfer.effectAllowed = "move";
    setDragging(true);
  }

  function handleDragEnd() {
    activeDragSource = null;
    startedOnControl.current = false;
    setDragging(false);
  }

  return (
    <div
      data-work-order-id={workOrderId}
      data-from-technician-id={sourceTechnicianId || undefined}
      data-dragging={dragging ? "true" : undefined}
      draggable={!disabled}
      onPointerDownCapture={handlePointerDown}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      role="group"
      aria-label={label}
      title={label}
      className={`${disabled ? "" : "cursor-grab active:cursor-grabbing"} ${
        dragging
          ? "rounded-xl opacity-60 outline-2 outline-dashed outline-offset-2 outline-[var(--ink,#101310)]"
          : ""
      } ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
