"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateLocalized } from "@/lib/dates";
import MarkdownEditor from "@/components/MarkdownEditor";
import {
  PORTAL_SLOT_EVENT,
  type PortalSlotDetail,
} from "@/components/portal/slot-selection";
import {
  bookWorkOrderAction,
  type BookingActionState,
} from "./booking-actions";

const INITIAL_STATE: BookingActionState = { status: "idle" };

const ERROR_KEYS: Record<string, string> = {
  forbidden: "portal.booking.errors.forbidden",
  missing_fields: "portal.booking.errors.missingFields",
  invalid: "portal.booking.errors.invalid",
  rate_limited: "portal.booking.errors.rateLimited",
  conflict: "portal.booking.errors.conflict",
  deadline_passed: "portal.booking.errors.deadlinePassed",
  error: "portal.booking.errors.generic",
  not_found: "portal.booking.errors.generic",
};

const TIME_OPTIONS = Array.from({ length: 23 }, (_, index) => {
  const minutes = 7 * 60 + index * 30;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
});

export type BookingEquipment = { id: string; label: string };

/**
 * Kundens bestillingsskjema. Ønsket dag kan velges fra ledighetkortene; da
 * fylles dato og ønsket tekniker inn her, og skjemaet rulles i syne.
 */
export default function BookingForm({
  minDate,
  defaultContactName,
  defaultContactPhone,
  equipment,
}: {
  minDate: string;
  defaultContactName: string;
  defaultContactPhone: string;
  equipment: BookingEquipment[];
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const [requestedDate, setRequestedDate] = useState("");
  const [requestedFrom, setRequestedFrom] = useState("08:00");
  const [requestedTo, setRequestedTo] = useState("12:00");
  const [technician, setTechnician] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [state, formAction, pending] = useActionState(
    async (previous: BookingActionState, formData: FormData) => {
      const result = await bookWorkOrderAction(previous, formData);
      if (result.status === "success") {
        // Nullstill både de ukontrollerte feltene og valgt ledig dag, slik at
        // en ny bestilling starter blankt.
        formRef.current?.reset();
        setRequestedDate("");
        setRequestedFrom("08:00");
        setRequestedTo("12:00");
        setTechnician(null);
      }
      return result;
    },
    INITIAL_STATE,
  );

  // Ledighetkortene ligger lenger ned på siden. De sender et hendelsesobjekt
  // i stedet for å dele React-tilstand på tvers av to server-rendrede seksjoner.
  useEffect(() => {
    const onSlotSelected = (event: Event) => {
      const detail = (event as CustomEvent<PortalSlotDetail>).detail;
      if (!detail?.date) return;
      setRequestedDate(detail.date);
      setTechnician(
        detail.technicianId
          ? { id: detail.technicianId, name: detail.technicianName }
          : null,
      );
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener(PORTAL_SLOT_EVENT, onSlotSelected);
    return () => window.removeEventListener(PORTAL_SLOT_EVENT, onSlotSelected);
  }, []);

  return (
    <form
      ref={formRef}
      id="booking-form"
      action={formAction}
      className="scroll-mt-24 space-y-4"
    >
      {state.status === "success" && (
        <div
          role="status"
          className="space-y-2 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-green-950"
        >
          <p className="text-base font-black">
            {state.duplicate
              ? t("portal.booking.successDuplicateTitle")
              : t("portal.booking.successTitle")}
          </p>
          <p className="text-sm font-bold">
            {t("portal.booking.reference", { reference: state.reference })}
          </p>
          <div className="text-sm">
            <p className="font-bold">{t("portal.booking.nextTitle")}</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>{t("portal.booking.nextStep1")}</li>
              <li>{t("portal.booking.nextStep2")}</li>
              <li>{t("portal.booking.nextStep3")}</li>
            </ol>
          </div>
          <a
            href="#bestillinger"
            className="inline-flex min-h-11 items-center text-sm font-bold text-green-900 underline"
          >
            {t("portal.booking.seeRequests")}
          </a>
        </div>
      )}

      {state.status === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800"
        >
          {t(ERROR_KEYS[state.reason] ?? "portal.booking.errors.generic")}
        </p>
      )}

      <div>
        <label
          htmlFor="booking-title"
          className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700"
        >
          {t("portal.booking.titleLabel")}
        </label>
        <input
          id="booking-title"
          type="text"
          name="title"
          required
          maxLength={200}
          placeholder={t("portal.booking.titlePlaceholder")}
          className="w-full rounded-xl border border-gray-300 bg-white p-2 text-sm text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label
          htmlFor="booking-description"
          className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700"
        >
          {t("portal.booking.descriptionLabel")}
        </label>
        <MarkdownEditor
          id="booking-description"
          name="description"
          rows={2}
          placeholder={t("portal.booking.descriptionPlaceholder")}
        />
      </div>

      <fieldset className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <legend className="px-1 text-sm font-bold text-gray-900">
          {t("portal.booking.slotLegend")}
        </legend>
        <p className="text-xs text-gray-600">{t("portal.booking.slotHint")}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label
              htmlFor="booking-date"
              className="mb-1 block text-xs font-bold text-gray-700"
            >
              {t("portal.booking.dateLabel")}
            </label>
            <input
              id="booking-date"
              type="date"
              name="requestedDate"
              required
              min={minDate}
              value={requestedDate}
              onChange={(event) => setRequestedDate(event.target.value)}
              className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm text-gray-900"
            />
          </div>
          <div>
            <label
              htmlFor="booking-from"
              className="mb-1 block text-xs font-bold text-gray-700"
            >
              {t("portal.booking.fromLabel")}
            </label>
            <select
              id="booking-from"
              name="requestedFrom"
              required
              value={requestedFrom}
              onChange={(event) => setRequestedFrom(event.target.value)}
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
              htmlFor="booking-to"
              className="mb-1 block text-xs font-bold text-gray-700"
            >
              {t("portal.booking.toLabel")}
            </label>
            <select
              id="booking-to"
              name="requestedTo"
              required
              value={requestedTo}
              onChange={(event) => setRequestedTo(event.target.value)}
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

        {requestedDate ? (
          <p className="rounded-lg bg-green-100 px-3 py-2 text-xs font-bold text-green-950">
            {technician
              ? t("portal.booking.selectedSlot", {
                  technician: technician.name || t("portal.availability.unknownName"),
                  date: formatDateLocalized(requestedDate, locale),
                  from: requestedFrom,
                  to: requestedTo,
                })
              : t("portal.booking.selectedDate", {
                  date: formatDateLocalized(requestedDate, locale),
                  from: requestedFrom,
                  to: requestedTo,
                })}
            {technician && (
              <button
                type="button"
                onClick={() => setTechnician(null)}
                className="ml-2 underline"
              >
                {t("portal.booking.clearTechnician")}
              </button>
            )}
          </p>
        ) : (
          <p className="text-xs text-gray-600">{t("portal.booking.dateHint")}</p>
        )}
        <input
          type="hidden"
          name="preferredTechnicianId"
          value={technician?.id ?? ""}
        />
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor="booking-equipment"
            className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700"
          >
            {t("portal.booking.equipmentLabel")}
          </label>
          <select
            id="booking-equipment"
            name="equipmentId"
            defaultValue=""
            className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm text-gray-900"
          >
            <option value="">{t("portal.booking.equipmentNone")}</option>
            {equipment.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="booking-contact-name"
            className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700"
          >
            {t("portal.booking.contactNameLabel")}
          </label>
          <input
            id="booking-contact-name"
            type="text"
            name="contactName"
            required
            maxLength={120}
            defaultValue={defaultContactName}
            placeholder={t("portal.booking.contactNamePlaceholder")}
            className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm text-gray-900 placeholder-gray-500"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="booking-contact-phone"
          className="mb-1 block text-xs font-bold uppercase tracking-wider text-gray-700"
        >
          {t("portal.booking.contactPhoneLabel")}
        </label>
        <input
          id="booking-contact-phone"
          type="tel"
          name="contactPhone"
          required
          maxLength={40}
          defaultValue={defaultContactPhone}
          placeholder={t("portal.booking.contactPhonePlaceholder")}
          className="min-h-11 w-full rounded-xl border border-gray-300 bg-white px-2 text-sm text-gray-900 placeholder-gray-500"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full whitespace-nowrap rounded-xl bg-[var(--primary-color)] px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? t("portal.booking.submitting") : t("portal.booking.submit")}
      </button>
    </form>
  );
}
