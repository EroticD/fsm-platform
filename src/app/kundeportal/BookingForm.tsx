"use client";

import { useActionState, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateLocalized } from "@/lib/dates";
import MarkdownEditor from "@/components/MarkdownEditor";
import Button from "@/components/ui/Button";
import { controlClassName } from "@/components/ui/controlStyles";
import AvailabilityBoard, {
  type HeldSlot,
  type SlotPickerSite,
} from "@/components/portal/AvailabilityBoard";
import {
  bookWorkOrderAction,
  releaseHoldAction,
  type BookingActionState,
} from "./booking-actions";

const INITIAL_STATE: BookingActionState = { status: "idle" };
const NEW_SITE = "__new__";

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

const SERVICE_TYPES = [
  "general",
  "maintenance",
  "repair",
  "inspection",
] as const;

type BookingEquipment = { id: string; label: string };

/**
 * Kundens bestillingsskjema i tre steg: sted → tjeneste → ledig time.
 *
 * Timen reserveres i fem minutter når kunden klikker på den. Skjemaet kan
 * derfor ikke sendes uten en aktiv reservasjon, og serveren kontrollerer
 * fortsatt både reservasjonen og overlapp før den bekrefter.
 */
export default function BookingForm({
  minDate,
  horizonEnd,
  minLeadHours = 24,
  defaultContactName,
  defaultContactPhone,
  equipment,
  sites,
}: {
  minDate: string;
  horizonEnd: string;
  minLeadHours?: number;
  defaultContactName: string;
  defaultContactPhone: string;
  equipment: BookingEquipment[];
  sites: SlotPickerSite[];
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState(() =>
    t("portal.bookingWizard.services.general"),
  );
  const [titleTouched, setTitleTouched] = useState(false);
  const [serviceType, setServiceType] = useState<string>("general");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? NEW_SITE);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteAddress, setNewSiteAddress] = useState("");
  const [newSitePostalCode, setNewSitePostalCode] = useState("");
  const [newSiteCity, setNewSiteCity] = useState("");
  const [equipmentId, setEquipmentId] = useState("");
  const [contactName, setContactName] = useState(defaultContactName);
  const [contactPhone, setContactPhone] = useState(defaultContactPhone);
  const [held, setHeld] = useState<HeldSlot | null>(null);
  const [formVersion, setFormVersion] = useState(0);

  const [state, formAction, pending] = useActionState(
    async (previous: BookingActionState, formData: FormData) => {
      const result = await bookWorkOrderAction(previous, formData);
      if (result.status === "success") {
        formRef.current?.reset();
        setTitle(t("portal.bookingWizard.services.general"));
        setTitleTouched(false);
        setServiceType("general");
        setSiteId(sites[0]?.id ?? NEW_SITE);
        setNewSiteName("");
        setNewSiteAddress("");
        setNewSitePostalCode("");
        setNewSiteCity("");
        setEquipmentId("");
        setContactName(defaultContactName);
        setContactPhone(defaultContactPhone);
        setHeld(null);
        setFormVersion((current) => current + 1);
      }
      return result;
    },
    INITIAL_STATE,
  );

  const serviceLabel = (type: string) =>
    t(`portal.bookingWizard.services.${type}`);

  const newSiteSelected = siteId === NEW_SITE;
  const canSubmit =
    !pending &&
    held !== null &&
    title.trim().length > 0 &&
    contactName.trim().length > 0 &&
    contactPhone.trim().length >= 5 &&
    (!newSiteSelected || newSiteName.trim().length > 0);

  const changeSite = async (value: string) => {
    if (value === siteId) return;
    if (held) {
      await releaseHoldAction(held.token);
      setHeld(null);
    }
    setSiteId(value);
  };

  return (
    <form
      ref={formRef}
      id="booking-form"
      action={formAction}
      className="scroll-mt-24 space-y-5"
    >
      {state.status === "success" && (
        <div
          role="status"
          className="space-y-2 rounded-2xl border border-[#b9cdb4] bg-[#eaf3e4] px-4 py-3 text-[#24502f]"
        >
          <p className="text-base font-black">
            {state.duplicate
              ? t("portal.booking.successDuplicateTitle")
              : state.bookingStatus === "CONFIRMED"
                ? t("portal.bookingWizard.successConfirmedTitle")
                : t("portal.booking.successTitle")}
          </p>
          <p className="text-sm font-bold">
            {t("portal.booking.reference", { reference: state.reference })}
          </p>
          <div className="text-sm">
            <p className="font-bold">
              {state.bookingStatus === "CONFIRMED"
                ? t("portal.bookingWizard.successConfirmedBody", {
                    technician:
                      state.technicianName ||
                      t("portal.availability.unknownName"),
                  })
                : t("portal.booking.nextTitle")}
            </p>
            {state.bookingStatus !== "CONFIRMED" && (
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>{t("portal.booking.nextStep1")}</li>
                <li>{t("portal.booking.nextStep2")}</li>
                <li>{t("portal.booking.nextStep3")}</li>
              </ol>
            )}
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

      {/* STEG 1: STED */}
      <fieldset className="space-y-3 rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-4">
        <legend className="px-1 text-sm font-bold text-[var(--ink,#101310)]">
          {t("portal.bookingWizard.siteStep")}
        </legend>
        <div>
          <label
            htmlFor="booking-site"
            className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
          >
            {t("portal.bookingWizard.siteLabel")}
          </label>
          <select
            id="booking-site"
            value={siteId}
            onChange={(event) => void changeSite(event.target.value)}
            className={controlClassName("min-h-11")}
          >
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
                {site.address ? ` — ${site.address}` : ""}
              </option>
            ))}
            <option value={NEW_SITE}>{t("portal.bookingWizard.newSiteOption")}</option>
          </select>
        </div>

        {newSiteSelected && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label
                htmlFor="booking-new-site-name"
                className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
              >
                {t("portal.bookingWizard.newSiteName")}
              </label>
              <input
                id="booking-new-site-name"
                type="text"
                name="newSiteName"
                required
                maxLength={200}
                value={newSiteName}
                onChange={(event) => setNewSiteName(event.target.value)}
                className={controlClassName("min-h-11")}
              />
            </div>
            <div className="sm:col-span-2">
              <label
                htmlFor="booking-new-site-address"
                className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
              >
                {t("portal.bookingWizard.newSiteAddress")}
              </label>
              <input
                id="booking-new-site-address"
                type="text"
                name="newSiteAddress"
                maxLength={500}
                value={newSiteAddress}
                onChange={(event) => setNewSiteAddress(event.target.value)}
                className={controlClassName("min-h-11")}
              />
            </div>
            <div>
              <label
                htmlFor="booking-new-site-postal"
                className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
              >
                {t("portal.bookingWizard.newSitePostalCode")}
              </label>
              <input
                id="booking-new-site-postal"
                type="text"
                name="newSitePostalCode"
                maxLength={120}
                value={newSitePostalCode}
                onChange={(event) => setNewSitePostalCode(event.target.value)}
                className={controlClassName("min-h-11")}
              />
            </div>
            <div>
              <label
                htmlFor="booking-new-site-city"
                className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
              >
                {t("portal.bookingWizard.newSiteCity")}
              </label>
              <input
                id="booking-new-site-city"
                type="text"
                name="newSiteCity"
                maxLength={120}
                value={newSiteCity}
                onChange={(event) => setNewSiteCity(event.target.value)}
                className={controlClassName("min-h-11")}
              />
            </div>
          </div>
        )}
        <input
          type="hidden"
          name="siteId"
          value={newSiteSelected ? "" : siteId}
        />
      </fieldset>

      {/* STEG 2: TJENESTE */}
      <fieldset className="space-y-3 rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-4">
        <legend className="px-1 text-sm font-bold text-[var(--ink,#101310)]">
          {t("portal.bookingWizard.serviceStep")}
        </legend>
        <div>
          <label
            htmlFor="booking-service"
            className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
          >
            {t("portal.bookingWizard.serviceLabel")}
          </label>
          <select
            id="booking-service"
            name="serviceType"
            value={serviceType}
            onChange={(event) => {
              const next = event.target.value;
              setServiceType(next);
              if (!titleTouched) setTitle(serviceLabel(next));
            }}
            className={controlClassName("min-h-11")}
          >
            {SERVICE_TYPES.map((type) => (
              <option key={type} value={type}>
                {serviceLabel(type)}
              </option>
            ))}
          </select>
        </div>
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
            onChange={(event) => {
              setTitleTouched(true);
              setTitle(event.target.value);
            }}
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
      </fieldset>

      {/* STEG 3: LEDIG TIME */}
      <fieldset className="space-y-3 rounded-2xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] p-4">
        <legend className="px-1 text-sm font-bold text-[var(--ink,#101310)]">
          {t("portal.bookingWizard.slotStep")}
        </legend>
        <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
          {t("portal.bookingWizard.leadTimeHint", {
            hours: minLeadHours,
            date: formatDateLocalized(minDate, locale),
          })}
        </p>
        <AvailabilityBoard
          sites={sites}
          minDate={minDate}
          horizonEnd={horizonEnd}
          siteId={newSiteSelected ? "" : siteId}
          onSelect={setHeld}
          onClear={() => setHeld(null)}
        />
        {held ? (
          <p
            role="status"
            className="rounded-lg border border-[#c7d98e] bg-[#f3fbd1] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]"
          >
            {t("portal.bookingWizard.selectedSlot", {
              technician:
                held.technicianName || t("portal.availability.unknownName"),
              date: formatDateLocalized(held.date, locale),
              from: held.from,
              to: held.to,
            })}
          </p>
        ) : (
          <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
            {t("portal.bookingWizard.pickSlot")}
          </p>
        )}
        <input type="hidden" name="requestedDate" value={held?.date ?? ""} />
        <input type="hidden" name="requestedFrom" value={held?.from ?? ""} />
        <input type="hidden" name="requestedTo" value={held?.to ?? ""} />
        <input type="hidden" name="technicianId" value={held?.technicianId ?? ""} />
        <input
          type="hidden"
          name="preferredTechnicianId"
          value={held?.technicianId ?? ""}
        />
        <input type="hidden" name="holdToken" value={held?.token ?? ""} />
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      </div>

      <Button
        type="submit"
        disabled={!canSubmit}
        pending={pending}
        className="w-full whitespace-nowrap"
      >
        {pending
          ? t("portal.bookingWizard.confirming")
          : t("portal.bookingWizard.confirm")}
      </Button>
    </form>
  );
}
