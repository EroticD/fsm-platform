"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  requestContactUpdateAction,
  type PortalFormState,
} from "@/app/kundeportal/report-actions";
import Button from "@/components/ui/Button";
import { controlClassName } from "@/components/ui/controlStyles";

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
      className="mt-4 space-y-2 border-t border-[var(--line,#dedcd1)] pt-4"
    >
      <label
        htmlFor="contact-update-message"
        className="block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
      >
        {t("p3.portalReports.requestUpdate")}
      </label>
      <p className="text-xs leading-5 text-[var(--muted,#62685f)]">
        {t("p3.portalReports.requestUpdateExplain")}
      </p>

      {state.status === "success" && (
        <p
          role="status"
          className="rounded-xl border border-[#b9cdb4] bg-[#eaf3e4] px-3 py-2 text-sm font-bold text-[#24502f]"
        >
          {t("p3.portalReports.requestUpdateSuccess")}
        </p>
      )}
      {state.status === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-[#e7b7a4] bg-[#fae8e0] px-3 py-2 text-sm font-bold text-[#a92a12]"
        >
          {t(ERROR_KEYS[state.reason] ?? "p3.portalReports.requestUpdateError")}
        </p>
      )}

      <textarea
        id="contact-update-message"
        name="message"
        rows={2}
        placeholder={t("p3.portalReports.requestUpdatePlaceholder")}
        className={controlClassName()}
      />
      <Button type="submit" variant="secondary" pending={pending}>
        {pending
          ? t("p3.portalReports.requestUpdateSending")
          : t("p3.portalReports.requestUpdateButton")}
      </Button>
    </form>
  );
}
