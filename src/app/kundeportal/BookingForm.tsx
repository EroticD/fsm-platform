"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import MarkdownEditor from "@/components/MarkdownEditor";
import {
  bookWorkOrderAction,
  type BookingActionState,
} from "./booking-actions";

const INITIAL_STATE: BookingActionState = { status: "idle" };

const ERROR_KEYS: Record<string, string> = {
  forbidden: "portal.booking.errors.forbidden",
  missing_fields: "portal.booking.errors.missingFields",
  rate_limited: "portal.booking.errors.rateLimited",
  conflict: "portal.booking.errors.conflict",
  error: "portal.booking.errors.generic",
  invalid: "portal.booking.errors.generic",
  not_found: "portal.booking.errors.generic",
};

/** Kundens bestillingsskjema med synlig kvittering og feilmelding. */
export default function BookingForm() {
  const t = useTranslations("common");
  const [state, formAction, pending] = useActionState(
    bookWorkOrderAction,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Tøm feltene etter en vellykket bestilling, så et nytt klikk ikke sender
  // samme tekst igjen ved en feil.
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      {state.status === "success" && (
        <p
          role="status"
          className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-bold text-green-900"
        >
          {state.duplicate
            ? t("portal.booking.successDuplicate")
            : t("portal.booking.success")}
        </p>
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
          className="block text-[10px] font-bold text-gray-700 mb-1 uppercase tracking-wider"
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
          className="w-full border border-gray-300 p-2 rounded-xl text-sm bg-white text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label
          htmlFor="booking-description"
          className="block text-[10px] font-bold text-gray-700 mb-1 uppercase tracking-wider"
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

      <button
        type="submit"
        disabled={pending}
        className="min-h-11 w-full bg-[var(--primary-color)] text-white px-4 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition whitespace-nowrap disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? t("portal.booking.submitting") : t("portal.booking.submit")}
      </button>
    </form>
  );
}
