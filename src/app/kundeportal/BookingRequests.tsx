"use client";

import { useActionState, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  formatDateLocalized,
  formatDateRangeLocalized,
  formatDateTimeLocalized,
} from "@/lib/dates";
import type { PortalBooking } from "@/server/portal";
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
  pending: "border-amber-200 bg-amber-100 text-amber-950",
  confirmed: "border-blue-200 bg-blue-100 text-blue-950",
  completed: "border-green-200 bg-green-100 text-green-950",
  cancelled: "border-gray-300 bg-gray-100 text-gray-700",
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
    <ol className="space-y-1 text-xs text-gray-700">
      {booking.events.map((event) => (
        <li key={event.id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-bold text-gray-900">{labels[event.type]}</span>
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
    <article className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-gray-900">
            {booking.workOrder.title}
          </p>
          <p className="text-xs font-bold text-gray-600">
            {t("portal.bookingRequests.reference", {
              reference: booking.reference,
            })}
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_CLASSES[cancelled ? "cancelled" : booking.displayStatus]}`}
        >
          {t(
            `portal.bookingRequests.status.${cancelled ? "cancelled" : booking.displayStatus}`,
          )}
        </span>
      </div>

      <dl className="grid gap-1 text-xs text-gray-700 sm:grid-cols-2">
        {isConfirmed ? (
          <div>
            <dt className="inline font-bold text-gray-900">
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
            <dt className="inline font-bold text-gray-900">
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
            <dt className="inline font-bold text-gray-900">
              {t("portal.bookingRequests.equipmentLabel")}{" "}
            </dt>
            <dd className="inline">{booking.equipmentLabel}</dd>
          </div>
        )}
        {booking.preferredTechnicianName && (
          <div>
            <dt className="inline font-bold text-gray-900">
              {t("portal.bookingRequests.technicianLabel")}{" "}
            </dt>
            <dd className="inline">{booking.preferredTechnicianName}</dd>
          </div>
        )}
        <div>
          <dt className="inline font-bold text-gray-900">
            {t("portal.bookingRequests.contactLabel")}{" "}
          </dt>
          <dd className="inline">
            {booking.contactName} · {booking.contactPhone}
          </dd>
        </div>
        <div>
          <dt className="inline font-bold text-gray-900">
            {t("portal.bookingRequests.createdLabel")}{" "}
          </dt>
          <dd className="inline">
            {formatDateTimeLocalized(booking.createdAt, locale)}
          </dd>
        </div>
      </dl>

      <div className="border-t border-gray-200 pt-2">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-600">
          {t("portal.bookingRequests.historyTitle")}
        </p>
        <EventList booking={booking} />
      </div>

      {changeError && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800"
        >
          {t(ERROR_KEYS[changeError.reason] ?? "portal.booking.errors.generic")}
        </p>
      )}
      {cancelState.status === "success" && (
        <p role="status" className="text-xs font-bold text-green-900">
          {t(
            cancelState.visitInProgress
              ? "portal.bookingRequests.cancelInProgressSuccess"
              : "portal.bookingRequests.cancelSuccess",
          )}
        </p>
      )}
      {rescheduleState.status === "success" && (
        <p role="status" className="text-xs font-bold text-green-900">
          {t("portal.bookingRequests.rescheduleSuccess")}
        </p>
      )}

      {!cancelled &&
        booking.displayStatus !== "completed" &&
        (canCancel || canReschedule) && (
          <div className="space-y-3 border-t border-gray-200 pt-3">
            {isConfirmed && inProgress && (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950">
                {t("portal.bookingRequests.inProgressNotice")}
              </p>
            )}
            {canReschedule && (
              <p className="text-xs text-gray-700">
                {t("portal.bookingRequests.deadline", {
                  date: formatDateTimeLocalized(booking.changeDeadline, locale),
                })}
              </p>
            )}
            {!isConfirmed && !canReschedule && (
              <p className="text-xs text-gray-700">
                {t("portal.bookingRequests.pendingCancelNote")}
              </p>
            )}

            {!confirmCancel ? (
              <div className="flex flex-wrap gap-2">
                {canReschedule && (
                  <button
                    type="button"
                    onClick={() => setShowReschedule((current) => !current)}
                    aria-expanded={showReschedule}
                    className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-800 hover:bg-gray-100"
                  >
                    {t("portal.bookingRequests.rescheduleButton")}
                  </button>
                )}
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(true)}
                    className="min-h-11 rounded-xl border border-red-300 bg-white px-3 py-2 text-sm font-bold text-red-800 hover:bg-red-50"
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
              <form action={cancelAction} className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
                <input type="hidden" name="bookingId" value={booking.id} />
                <p className="text-sm font-bold text-red-900">
                  {t(
                    isConfirmed
                      ? inProgress
                        ? "portal.bookingRequests.cancelInProgressConfirm"
                        : "portal.bookingRequests.cancelConfirmedConfirm"
                      : "portal.bookingRequests.cancelConfirm",
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={cancelPending}
                    className="min-h-11 rounded-xl bg-red-700 px-3 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-wait disabled:opacity-60"
                  >
                    {cancelPending
                      ? t("portal.bookingRequests.cancelPending")
                      : t("portal.bookingRequests.cancelConfirmButton")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(false)}
                    className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-800 hover:bg-gray-100"
                  >
                    {t("portal.bookingRequests.keepButton")}
                  </button>
                </div>
              </form>
            )}

            {showReschedule && canReschedule && (
              <form
                ref={rescheduleFormRef}
                action={rescheduleAction}
                className="space-y-2 rounded-xl border border-gray-200 bg-white p-3"
              >
                <input type="hidden" name="bookingId" value={booking.id} />
                <p className="text-sm font-bold text-gray-900">
                  {t("portal.bookingRequests.rescheduleTitle")}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div>
                    <label
                      htmlFor={`reschedule-date-${booking.id}`}
                      className="mb-1 block text-xs font-bold text-gray-700"
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
                      className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm text-gray-900"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`reschedule-from-${booking.id}`}
                      className="mb-1 block text-xs font-bold text-gray-700"
                    >
                      {t("portal.booking.fromLabel")}
                    </label>
                    <select
                      id={`reschedule-from-${booking.id}`}
                      name="requestedFrom"
                      required
                      value={rescheduleFrom}
                      onChange={(event) => setRescheduleFrom(event.target.value)}
                      className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm text-gray-900"
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
                      className="mb-1 block text-xs font-bold text-gray-700"
                    >
                      {t("portal.booking.toLabel")}
                    </label>
                    <select
                      id={`reschedule-to-${booking.id}`}
                      name="requestedTo"
                      required
                      value={rescheduleTo}
                      onChange={(event) => setRescheduleTo(event.target.value)}
                      className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm text-gray-900"
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
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800"
                  >
                    {t("portal.bookingRequests.leadTimeError", {
                      hours: minLeadHours,
                    })}
                  </p>
                )}
                {rescheduleWindowInvalid && (
                  <p
                    role="alert"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800"
                  >
                    {t("portal.booking.windowError")}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={!canSubmitReschedule}
                  className="min-h-11 rounded-xl bg-[var(--primary-color)] px-3 py-2 text-sm font-bold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                >
                  {reschedulePending
                    ? t("portal.bookingRequests.reschedulePending")
                    : t("portal.bookingRequests.rescheduleSubmit")}
                </button>
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
    <section id="bestillinger" className="mt-6 space-y-3 border-t border-gray-200 pt-5">
      <div>
        <h3 className="text-base font-black text-gray-900">
          {t("portal.bookingRequests.title")}
        </h3>
        <p className="text-xs text-gray-600">
          {t("portal.bookingRequests.desc")}
        </p>
        {summary && (
          <p className="mt-1 text-xs font-bold text-gray-600">{summary}</p>
        )}
      </div>
      {bookings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
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
