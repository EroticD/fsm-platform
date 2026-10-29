"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateLocalized } from "@/lib/dates";
import MarkdownEditor from "@/components/MarkdownEditor";
import Button from "@/components/ui/Button";
import { controlClassName } from "@/components/ui/controlStyles";
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

type BookingEquipment = { id: string; label: string };

/**
 * Kundens bestillingsskjema. Ønsket dag kan velges fra ledighetkortene; da
 * fylles dato og ønsket tekniker inn her, og skjemaet rulles i syne.
 */
export default function BookingForm({
  minDate,
  minFromTime = "07:00",
  minLeadHours = 24,
  defaultContactName,
  defaultContactPhone,
  equipment,
}: {
  minDate: string;
  minFromTime?: string;
  minLeadHours?: number;
  defaultContactName: string;
  defaultContactPhone: string;
  equipment: BookingEquipment[];
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [requestedDate, setRequestedDate] = useState("");
  const [requestedFrom, setRequestedFrom] = useState("08:00");
  const [requestedTo, setRequestedTo] = useState("12:00");
  const [equipmentId, setEquipmentId] = useState("");
  const [contactName, setContactName] = useState(defaultContactName);
  const [contactPhone, setContactPhone] = useState(defaultContactPhone);
  // MarkdownEditor holder teksten i egen tilstand. Den må remountes etter en
  // vellykket sending for å bli blank, men aldri etter en feil.
  const [formVersion, setFormVersion] = useState(0);
  const [technician, setTechnician] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [state, formAction, pending] = useActionState(
    async (previous: BookingActionState, formData: FormData) => {
      const result = await bookWorkOrderAction(previous, formData);
      if (result.status === "success") {
        // Nullstill både de ukontrollerte feltene og valgt ledig dag, slik at
        // en ny forespørsel starter blankt.
        formRef.current?.reset();
        setTitle("");
        setRequestedDate("");
        setRequestedFrom("08:00");
        setRequestedTo("12:00");
        setEquipmentId("");
        setContactName(defaultContactName);
        setContactPhone(defaultContactPhone);
        setTechnician(null);
        setFormVersion((current) => current + 1);
      }
      return result;
    },
    INITIAL_STATE,
  );

  // Serverfeil skal ikke tømme feltene kunden allerede har skrevet. Derfor er
  // feltene kontrollert og nullstilles bare ved suksess.
  const leadTimeInvalid =
    requestedDate !== "" &&
    (requestedDate < minDate ||
      (requestedDate === minDate && requestedFrom < minFromTime));
  const windowInvalid = requestedTo <= requestedFrom;
  const canSubmit = !pending && !leadTimeInvalid && !windowInvalid;

  const onDateChange = (value: string) => {
    setRequestedDate(value);
    if (value === minDate && requestedFrom < minFromTime) {
      setRequestedFrom(minFromTime);
      if (requestedTo <= minFromTime) {
        const next = TIME_OPTIONS.find((time) => time > minFromTime);
        if (next) setRequestedTo(next);
      }
    }
  };

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
          className="space-y-2 rounded-2xl border border-[#b9cdb4] bg-[#eaf3e4] px-4 py-3 text-[#24502f]"
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
            className="inline-flex min-h-11 items-center text-sm font-bold text-[#24502f] underline decoration-[#24502f] decoration-2 underline-offset-4"
          >
            {t("portal.booking.seeRequests")}
          </a>
        </div>
      )}

      {state.status === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-[#e7b7a4] bg-[#fae8e0] px-3 py-2 text-sm font-bold text-[#a92a12]"
        >
          {t(ERROR_KEYS[state.reason] ?? "portal.booking.errors.generic")}
        </p>
      )}

      <div>
        <label
          htmlFor="booking-title"
          className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
        >
          {t("portal.booking.titleLabel")}
        </label>
        <input
          id="booking-title"
          type="text"
          name="title"
          required
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("portal.booking.titlePlaceholder")}
          className={controlClassName()}
        />
      </div>

      <div>
        <label
          htmlFor="booking-description"
          className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
        >
          {t("portal.booking.descriptionLabel")}
        </label>
        <MarkdownEditor
          key={formVersion}
          id="booking-description"
          name="description"
          rows={2}
          placeholder={t("portal.booking.descriptionPlaceholder")}
        />
      </div>

      <fieldset className="space-y-3 rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-4">
        <legend className="px-1 text-sm font-bold text-[var(--ink,#101310)]">
          {t("portal.booking.slotLegend")}
        </legend>
        <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
          {t("portal.booking.slotHint")}
        </p>
        <p className="text-xs font-bold leading-5 text-[var(--muted,#62685f)]">
          {t("portal.booking.leadTimeHint", {
            hours: minLeadHours,
            date: formatDateLocalized(minDate, locale),
            time: minFromTime,
          })}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label
              htmlFor="booking-date"
              className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
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
              onChange={(event) => onDateChange(event.target.value)}
              className={controlClassName("min-h-11")}
            />
          </div>
          <div>
            <label
              htmlFor="booking-from"
              className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
            >
              {t("portal.booking.fromLabel")}
            </label>
            <select
              id="booking-from"
              name="requestedFrom"
              required
              value={requestedFrom}
              onChange={(event) => setRequestedFrom(event.target.value)}
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
              htmlFor="booking-to"
              className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
            >
              {t("portal.booking.toLabel")}
            </label>
            <select
              id="booking-to"
              name="requestedTo"
              required
              value={requestedTo}
              onChange={(event) => setRequestedTo(event.target.value)}
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

        {leadTimeInvalid && (
          <p
            role="alert"
            className="rounded-lg border border-[#e7b7a4] bg-[#fae8e0] px-3 py-2 text-xs font-bold text-[#a92a12]"
          >
            {t("portal.booking.leadTimeError", { hours: minLeadHours })}
          </p>
        )}
        {windowInvalid && (
          <p
            role="alert"
            className="rounded-lg border border-[#e7b7a4] bg-[#fae8e0] px-3 py-2 text-xs font-bold text-[#a92a12]"
          >
            {t("portal.booking.windowError")}
          </p>
        )}

        {requestedDate ? (
          <p className="rounded-lg border border-[#c7d98e] bg-[#f3fbd1] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]">
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
          <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
            {t("portal.booking.dateHint")}
          </p>
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
            className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
          >
            {t("portal.booking.equipmentLabel")}
          </label>
          <select
            id="booking-equipment"
            name="equipmentId"
            value={equipmentId}
            onChange={(event) => setEquipmentId(event.target.value)}
            className={controlClassName("min-h-11")}
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
            className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
          >
            {t("portal.booking.contactNameLabel")}
          </label>
          <input
            id="booking-contact-name"
            type="text"
            name="contactName"
            required
            maxLength={120}
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            placeholder={t("portal.booking.contactNamePlaceholder")}
            className={controlClassName("min-h-11")}
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="booking-contact-phone"
          className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
        >
          {t("portal.booking.contactPhoneLabel")}
        </label>
        <input
          id="booking-contact-phone"
          type="tel"
          name="contactPhone"
          required
          maxLength={40}
          value={contactPhone}
          onChange={(event) => setContactPhone(event.target.value)}
          placeholder={t("portal.booking.contactPhonePlaceholder")}
          className={controlClassName("min-h-11")}
        />
      </div>

      <Button
        type="submit"
        disabled={!canSubmit}
        pending={pending}
        className="w-full whitespace-nowrap"
      >
        {pending ? t("portal.booking.submitting") : t("portal.booking.submit")}
      </Button>
    </form>
  );
}
