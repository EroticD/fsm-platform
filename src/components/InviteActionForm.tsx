"use client";

import { useActionState, type ReactNode } from "react";
import CopyButton from "@/components/CopyButton";
import type {
  InviteActionLabels,
  InviteActionState,
} from "@/lib/invite-action-state";

type InviteAction = (
  state: InviteActionState,
  formData: FormData,
) => Promise<InviteActionState>;

/**
 * Skjema for invitasjonshandlinger som viser den ene gyldige lenken i
 * sideinnholdet etter at handlingen er utført.
 *
 * Nøkkelen kommer som returverdi fra server-actionen, ikke som en URL. Da
 * havner den verken i adressefeltet, historikken, referrer-headere eller
 * serverlogger. Lenken vises bare når e-posten ikke ble sendt.
 */
export default function InviteActionForm({
  action,
  labels,
  children,
  submitLabel,
  wrapperClassName,
  formClassName,
  buttonClassName,
  bannerClassName,
}: {
  action: InviteAction;
  labels: InviteActionLabels;
  children?: ReactNode;
  submitLabel?: ReactNode;
  wrapperClassName?: string;
  formClassName?: string;
  buttonClassName?: string;
  bannerClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    status: "idle",
  } satisfies InviteActionState);

  return (
    <div className={wrapperClassName}>
      {state.status === "invite" && (
        <div
          className={
            bannerClassName ??
            "mb-3 rounded-xl border border-green-200 bg-green-50 p-4 text-xs text-green-900"
          }
        >
          <p className="font-bold">
            {labels.ready.replace("{name}", state.name || "")}
          </p>
          <p className="mt-1 text-green-800">
            {state.mailSent ? labels.sent : labels.manual}
          </p>
          {!state.mailSent && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={state.inviteUrl}
                aria-label={labels.copy}
                className="flex-1 rounded-lg border border-green-300 bg-white px-3 py-2 font-mono text-xs text-gray-700"
              />
              <CopyButton value={state.inviteUrl} label={labels.copy} />
            </div>
          )}
        </div>
      )}

      {state.status === "error" && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
          {labels.error}
        </div>
      )}

      <form action={formAction} className={formClassName}>
        <fieldset disabled={pending} className="contents">
          {children}
        </fieldset>
        {submitLabel && (
          <button type="submit" className={buttonClassName}>
            {submitLabel}
          </button>
        )}
      </form>
    </div>
  );
}
