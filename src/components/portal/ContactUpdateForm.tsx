"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  requestContactUpdateAction,
  type PortalFormState,
} from "@/app/kundeportal/report-actions";

const INITIAL_STATE: PortalFormState = { status: "idle" };

const ERROR_KEYS: Record<string, string> = {
  forbidden: "p3.portalReports.updateForbidden",
  not_found: "p3.portalReports.updateError",
  error: "p3.portalReports.updateError",
};

/** Kontaktoppdatering med kvittering, feilmelding og tømming ved suksess. */
export default function ContactUpdateForm() {
  const t = useTranslations("common");
  const [state, formAction, pending] = useActionState(
    requestContactUpdateAction,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="mt-4 space-y-2 border-t border-gray-200 pt-4"
    >
      <label htmlFor="contact-update-message" className="block text-sm font-bold text-gray-700">
        {t("p3.portalReports.requestUpdate")}
      </label>
      <p className="text-xs text-gray-600">
        {t("p3.portalReports.requestUpdateExplain")}
      </p>

      {state.status === "success" && (
        <p
          role="status"
          className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-bold text-green-900"
        >
          {t("p3.portalReports.requestUpdateSuccess")}
        </p>
      )}
      {state.status === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800"
        >
          {t(ERROR_KEYS[state.reason] ?? "p3.portalReports.requestUpdateError")}
        </p>
      )}

      <textarea
        id="contact-update-message"
        name="message"
        rows={2}
        placeholder={t("p3.portalReports.requestUpdatePlaceholder")}
        className="w-full rounded-xl border border-gray-300 bg-white p-2.5 text-sm text-gray-900"
      />
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
      >
        {pending
          ? t("p3.portalReports.requestUpdateSending")
          : t("p3.portalReports.requestUpdateButton")}
      </button>
    </form>
  );
}
