"use client";

import { useActionState, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  formatDateLocalized,
  formatDateRangeLocalized,
  formatDateTimeLocalized,
} from "@/lib/dates";
import type { PortalBooking } from "@/server/portal";
import Button from "@/components/ui/Button";
import { controlClassName } from "@/components/ui/controlStyles";
import {
  cancelBookingAction,
  rescheduleBookingAction,
  type BookingChangeState,
} from "./booking-actions";

const INITIAL_STATE: BookingChangeState = { status: "idle" };

const ERROR_KEYS: Record<string, string> = {
  forbidden: "portal.booking.errors.forbidden",
  missing_fields: "portal.booking.errors.missingFields",
  invalid: "portal.booking.errors.invalid",
  not_found: "portal.booking.errors.generic",
  conflict: "portal.booking.errors.conflict",
  deadline_passed: "portal.booking.errors.deadlinePassed",
  error: "portal.booking.errors.generic",
};

const STATUS_CLASSES: Record<PortalBooking["displayStatus"], string> = {
  pending: "border-[#e2cf9b] bg-[#fbf1d2] text-[#6b4a05]",
  confirmed:
    "border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]",
  completed: "border-[#b9cdb4] bg-[#eaf3e4] text-[#24502f]",
  cancelled:
    "border-[#e7b7a4] bg-[#fae8e0] text-[#a92a12]",
};

const TIME_OPTIONS = Array.from({ length: 23 }, (_, index) => {
  const minutes = 7 * 60 + index * 30;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
});

function EventList({ booking }: { booking: PortalBooking }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const labels: Record<PortalBooking["events"][number]["type"], string> = {
    CREATED: t("portal.bookingRequests.event.CREATED"),
    RESCHEDULED: t("portal.bookingRequests.event.RESCHEDULED"),
    CANCELLED: t("portal.bookingRequests.event.CANCELLED"),
  };

  return (
    <ol className="space-y-1 text-xs leading-5 text-[var(--muted,#62685f)]">
      {booking.events.map((event) => (
        <li key={event.id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-bold text-[var(--ink,#101310)]">
            {labels[event.type]}
          </span>
          <time dateTime={event.createdAt}>
            {formatDateTimeLocalized(event.createdAt, locale)}
          </time>
          {event.requestedDate && event.requestedFrom && event.requestedTo && (
            <span>
              {t("portal.bookingRequests.event.window", {
                date: formatDateLocalized(event.requestedDate, locale),
                from: event.requestedFrom,
                to: event.requestedTo,
              })}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function BookingRequestCard({
  booking,
  minDate,
  minFromTime,
  minLeadHours,
}: {
  booking: PortalBooking;
  minDate: string;
  minFromTime: string;
  minLeadHours: number;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const rescheduleFormRef = useRef<HTMLFormElement>(null);
  const [rescheduleDate, setRescheduleDate] = useState(booking.requestedDate);
  const [rescheduleFrom, setRescheduleFrom] = useState(booking.requestedFrom);
  const [rescheduleTo, setRescheduleTo] = useState(booking.requestedTo);

  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelBookingAction,
    INITIAL_STATE,
  );
  const [rescheduleState, rescheduleAction, reschedulePending] = useActionState(
    async (previous: BookingChangeState, formData: FormData) => {
      const result = await rescheduleBookingAction(previous, formData);
      if (result.status === "success") {
        setRescheduleDate(String(formData.get("requestedDate") ?? ""));
        setRescheduleFrom(String(formData.get("requestedFrom") ?? ""));
        setRescheduleTo(String(formData.get("requestedTo") ?? ""));
        rescheduleFormRef.current?.reset();
        setShowReschedule(false);
      }
      return result;
    },
    INITIAL_STATE,
  );

  const cancelled =
    booking.displayStatus === "cancelled" || cancelState.status === "success";
  const isConfirmed = booking.displayStatus === "confirmed";
  const inProgress = booking.workOrder.status === "IN_PROGRESS";
  const canCancel = booking.canCancel && !cancelled;
  const canReschedule = booking.canReschedule && !cancelled;
  const rescheduleLeadInvalid =
    rescheduleDate !== "" &&
    (rescheduleDate < minDate ||
      (rescheduleDate === minDate && rescheduleFrom < minFromTime));
  const rescheduleWindowInvalid = rescheduleTo <= rescheduleFrom;
  const canSubmitReschedule =
    !reschedulePending && !rescheduleLeadInvalid && !rescheduleWindowInvalid;
  const changeError =
    cancelState.status === "error"
      ? cancelState
      : rescheduleState.status === "error"
        ? rescheduleState
        : null;

  return (
    <article className="space-y-3 rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-[var(--ink,#101310)]">
            {booking.workOrder.title}
          </p>
          <p className="text-xs font-bold text-[var(--muted,#62685f)]">
            {t("portal.bookingRequests.reference", {
              reference: booking.reference,
            })}
          </p>
        </div>
        <span
          className={`inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_CLASSES[cancelled ? "cancelled" : booking.displayStatus]}`}
        >
          {t(
            `portal.bookingRequests.status.${cancelled ? "cancelled" : booking.displayStatus}`,
          )}
        </span>
      </div>

      <dl className="grid gap-1 text-xs leading-5 text-[var(--muted,#62685f)] sm:grid-cols-2">
        {isConfirmed ? (
          <div>
            <dt className="inline font-bold text-[var(--ink,#101310)]">
              {t("portal.bookingRequests.confirmedLabel")}{" "}
            </dt>
            <dd className="inline">
              {booking.workOrder.scheduledFor
                ? formatDateRangeLocalized(
                    booking.workOrder.scheduledFor,
                    booking.workOrder.scheduledTo,
                    locale,
                  )
                : t("portal.bookingRequests.confirmedTimeFallback")}
            </dd>
          </div>
        ) : (
          <div>
            <dt className="inline font-bold text-[var(--ink,#101310)]">
              {t("portal.bookingRequests.requestedLabel")}{" "}
            </dt>
            <dd className="inline">
              {formatDateLocalized(booking.requestedDate, locale)}{" "}
              {t("portal.bookingRequests.window", {
                from: booking.requestedFrom,
                to: booking.requestedTo,
              })}
            </dd>
          </div>
        )}
        {booking.equipmentLabel && (
          <div>
            <dt className="inline font-bold text-[var(--ink,#101310)]">
              {t("portal.bookingRequests.equipmentLabel")}{" "}
            </dt>
            <dd className="inline">{booking.equipmentLabel}</dd>
          </div>
        )}
        {booking.preferredTechnicianName && (
          <div>
            <dt className="inline font-bold text-[var(--ink,#101310)]">
              {t("portal.bookingRequests.technicianLabel")}{" "}
            </dt>
            <dd className="inline">{booking.preferredTechnicianName}</dd>
          </div>
        )}
        <div>
          <dt className="inline font-bold text-[var(--ink,#101310)]">
            {t("portal.bookingRequests.contactLabel")}{" "}
          </dt>
          <dd className="inline">
            {booking.contactName} · {booking.contactPhone}
          </dd>
        </div>
        <div>
          <dt className="inline font-bold text-[var(--ink,#101310)]">
            {t("portal.bookingRequests.createdLabel")}{" "}
          </dt>
          <dd className="inline">
            {formatDateTimeLocalized(booking.createdAt, locale)}
          </dd>
        </div>
      </dl>

      <div className="border-t border-[var(--line,#dedcd1)] pt-2">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted,#62685f)]">
          {t("portal.bookingRequests.historyTitle")}
        </p>
        <EventList booking={booking} />
      </div>

      {changeError && (
        <p
          role="alert"
          className="rounded-xl border border-[#e7b7a4] bg-[#fae8e0] px-3 py-2 text-xs font-bold text-[#a92a12]"
        >
          {t(ERROR_KEYS[changeError.reason] ?? "portal.booking.errors.generic")}
        </p>
      )}
      {cancelState.status === "success" && (
        <p role="status" className="text-xs font-bold text-[#24502f]">
          {t(
            cancelState.visitInProgress
              ? "portal.bookingRequests.cancelInProgressSuccess"
              : "portal.bookingRequests.cancelSuccess",
          )}
        </p>
      )}
      {rescheduleState.status === "success" && (
        <p role="status" className="text-xs font-bold text-[#24502f]">
          {t("portal.bookingRequests.rescheduleSuccess")}
        </p>
      )}

      {!cancelled &&
        booking.displayStatus !== "completed" &&
        (canCancel || canReschedule) && (
          <div className="space-y-3 border-t border-[var(--line,#dedcd1)] pt-3">
            {isConfirmed && inProgress && (
              <p className="rounded-xl border border-[#e2cf9b] bg-[#fbf1d2] px-3 py-2 text-xs font-bold text-[#6b4a05]">
                {t("portal.bookingRequests.inProgressNotice")}
              </p>
            )}
            {canReschedule && (
              <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
                {t("portal.bookingRequests.deadline", {
                  date: formatDateTimeLocalized(booking.changeDeadline, locale),
                })}
              </p>
            )}
            {!isConfirmed && !canReschedule && (
              <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
                {t("portal.bookingRequests.pendingCancelNote")}
              </p>
            )}

            {!confirmCancel ? (
              <div className="flex flex-wrap gap-2">
                {canReschedule && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowReschedule((current) => !current)}
                    aria-expanded={showReschedule}
                  >
                    {t("portal.bookingRequests.rescheduleButton")}
                  </Button>
                )}
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(true)}
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--risk,#f04427)] bg-transparent px-4 text-sm font-bold text-[#a92a12] transition hover:bg-[#fae8e0]"
                  >
                    {t(
                      isConfirmed
                        ? "portal.bookingRequests.cancelConfirmedButton"
                        : "portal.bookingRequests.cancelButton",
                    )}
                  </button>
                )}
              </div>
            ) : (
              <form
                action={cancelAction}
                className="space-y-2 rounded-xl border border-[#e7b7a4] bg-[#fae8e0] p-3"
              >
                <input type="hidden" name="bookingId" value={booking.id} />
                <p className="text-sm font-bold leading-6 text-[#8f2d0c]">
                  {t(
                    isConfirmed
                      ? inProgress
                        ? "portal.bookingRequests.cancelInProgressConfirm"
                        : "portal.bookingRequests.cancelConfirmedConfirm"
                      : "portal.bookingRequests.cancelConfirm",
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    variant="danger"
                    pending={cancelPending}
                  >
                    {cancelPending
                      ? t("portal.bookingRequests.cancelPending")
                      : t("portal.bookingRequests.cancelConfirmButton")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setConfirmCancel(false)}
                  >
                    {t("portal.bookingRequests.keepButton")}
                  </Button>
                </div>
              </form>
            )}

            {showReschedule && canReschedule && (
              <form
                ref={rescheduleFormRef}
                action={rescheduleAction}
                className="space-y-3 rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3"
              >
                <input type="hidden" name="bookingId" value={booking.id} />
                <p className="text-sm font-bold text-[var(--ink,#101310)]">
                  {t("portal.bookingRequests.rescheduleTitle")}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <label
                      htmlFor={`reschedule-date-${booking.id}`}
                      className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
                    >
                      {t("portal.booking.dateLabel")}
                    </label>
                    <input
                      id={`reschedule-date-${booking.id}`}
                      type="date"
                      name="requestedDate"
                      required
                      min={minDate}
                      value={rescheduleDate}
                      onChange={(event) => setRescheduleDate(event.target.value)}
                      className={controlClassName("min-h-11")}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`reschedule-from-${booking.id}`}
                      className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
                    >
                      {t("portal.booking.fromLabel")}
                    </label>
                    <select
                      id={`reschedule-from-${booking.id}`}
                      name="requestedFrom"
                      required
                      value={rescheduleFrom}
                      onChange={(event) => setRescheduleFrom(event.target.value)}
                      className={controlClassName("min-h-11")}
                    >
                      {TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor={`reschedule-to-${booking.id}`}
                      className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
                    >
                      {t("portal.booking.toLabel")}
                    </label>
                    <select
                      id={`reschedule-to-${booking.id}`}
                      name="requestedTo"
                      required
                      value={rescheduleTo}
                      onChange={(event) => setRescheduleTo(event.target.value)}
                      className={controlClassName("min-h-11")}
                    >
                      {TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {rescheduleLeadInvalid && (
                  <p
                    role="alert"
                    className="rounded-lg border border-[#e7b7a4] bg-[#fae8e0] px-3 py-2 text-xs font-bold text-[#a92a12]"
                  >
                    {t("portal.bookingRequests.leadTimeError", {
                      hours: minLeadHours,
                    })}
                  </p>
                )}
                {rescheduleWindowInvalid && (
                  <p
                    role="alert"
                    className="rounded-lg border border-[#e7b7a4] bg-[#fae8e0] px-3 py-2 text-xs font-bold text-[#a92a12]"
                  >
                    {t("portal.booking.windowError")}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={!canSubmitReschedule}
                  pending={reschedulePending}
                >
                  {reschedulePending
                    ? t("portal.bookingRequests.reschedulePending")
                    : t("portal.bookingRequests.rescheduleSubmit")}
                </Button>
              </form>
            )}
          </div>
        )}
    </article>
  );
}

/** Kundens bestillinger med status, frist og endringshistorikk. */
export default function BookingRequests({
  bookings,
  minDate,
  minFromTime,
  minLeadHours,
  summary,
}: {
  bookings: PortalBooking[];
  minDate: string;
  minFromTime: string;
  minLeadHours: number;
  summary?: string;
}) {
  const t = useTranslations("common");

  return (
    <section className="mt-6 space-y-3 border-t border-[var(--line,#dedcd1)] pt-5">
      <div>
        <h3 className="text-base font-extrabold text-[var(--ink,#101310)]">
          {t("portal.bookingRequests.title")}
        </h3>
        <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
          {t("portal.bookingRequests.desc")}
        </p>
        {summary && (
          <p className="mt-1 text-xs font-bold text-[var(--muted,#62685f)]">{summary}</p>
        )}
      </div>
      {bookings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] px-4 py-6 text-center text-sm text-[var(--muted,#62685f)]">
          {t("portal.bookingRequests.empty")}
        </p>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <BookingRequestCard
              key={booking.id}
              booking={booking}
              minDate={minDate}
              minFromTime={minFromTime}
              minLeadHours={minLeadHours}
            />
          ))}
        </div>
      )}
    </section>
  );
}
