"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  acknowledgeReportAction,
  type PortalFormState,
} from "@/app/kundeportal/report-actions";
import Button from "@/components/ui/Button";
import { controlClassName } from "@/components/ui/controlStyles";

const INITIAL_STATE: PortalFormState = { status: "idle" };

const ERROR_KEYS: Record<string, string> = {
  forbidden: "p3.portalReports.acknowledgeForbidden",
  not_found: "p3.portalReports.acknowledgeNotFound",
  invalid: "p3.portalReports.acknowledgeError",
  error: "p3.portalReports.acknowledgeError",
};

/**
 * Kvitteringsskjema med synlig innsendingsstatus. Kommentaren tømmes når
 * kvitteringen er registrert, slik at neste rapport starter blankt.
 */
export default function AcknowledgeReportForm({
  workOrderId,
  reportId,
}: {
  workOrderId: string;
  reportId: string;
}) {
  const t = useTranslations("common");
  const [state, formAction, pending] = useActionState(
    acknowledgeReportAction,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="workOrderId" value={workOrderId} />
      <input type="hidden" name="reportId" value={reportId} />

      {state.status === "success" && (
        <p
          role="status"
          className="rounded-xl border border-[#b9cdb4] bg-[#eaf3e4] px-3 py-2 text-xs font-bold text-[#24502f]"
        >
          {t("p3.portalReports.acknowledgeSuccess")}
        </p>
      )}
      {state.status === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-[#e7b7a4] bg-[#fae8e0] px-3 py-2 text-xs font-bold text-[#a92a12]"
        >
          {t(ERROR_KEYS[state.reason] ?? "p3.portalReports.acknowledgeError")}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="comment"
          aria-label={t("p3.portalReports.commentPlaceholder")}
          aria-describedby="kvittering-hjelp"
          placeholder={t("p3.portalReports.commentPlaceholder")}
          className={controlClassName("min-h-11 flex-1")}
        />
        <Button
          type="submit"
          pending={pending}
          aria-describedby="kvittering-hjelp"
        >
          {pending
            ? t("p3.portalReports.acknowledging")
            : t("p3.portalReports.acknowledge")}
        </Button>
      </div>
    </form>
  );
}
