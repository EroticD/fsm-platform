"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import Button from "@/components/ui/Button";
import { controlClassName } from "@/components/ui/controlStyles";
import {
  sendPortalMessageAction,
  type PortalMessageState,
} from "@/app/kundeportal/portal-expansion-actions";

const INITIAL: PortalMessageState = { status: "idle" };

const ERROR_KEYS: Record<string, string> = {
  forbidden: "portal.expansion.messages.errors.forbidden",
  invalid: "portal.expansion.messages.errors.invalid",
  not_found: "portal.expansion.messages.errors.notFound",
  conflict: "portal.expansion.messages.errors.conflict",
  rate_limited: "portal.expansion.messages.errors.rateLimited",
  error: "portal.expansion.messages.errors.generic",
};

export default function PortalMessageForm({
  threadId,
  consent,
}: {
  threadId: string;
  consent: boolean;
}) {
  const t = useTranslations("common");
  const [state, formAction, pending] = useActionState(
    sendPortalMessageAction,
    INITIAL,
  );

  if (!consent) {
    return (
      <p className="rounded-xl border border-[#e2cf9b] bg-[#fbf1d2] px-3 py-2 text-xs leading-5 text-[#6b4a05]">
        {t("portal.expansion.messages.consentMissing")}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="threadId" value={threadId} />
      <label
        htmlFor={`portal-message-${threadId}`}
        className="block text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted,#62685f)]"
      >
        {t("portal.expansion.messages.sendLabel")}
      </label>
      <textarea
        id={`portal-message-${threadId}`}
        name="body"
        required
        maxLength={1600}
        rows={3}
        placeholder={t("portal.expansion.messages.placeholder")}
        className={controlClassName("min-h-24 w-full resize-y")}
      />
      {state.status === "success" && (
        <p role="status" className="text-xs font-bold text-[#24502f]">
          {t("portal.expansion.messages.sent")}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-xs font-bold text-[#a92a12]">
          {t(ERROR_KEYS[state.reason] ?? "portal.expansion.messages.errors.generic")}
        </p>
      )}
      <Button type="submit" pending={pending} disabled={pending}>
        {pending
          ? t("portal.expansion.messages.sending")
          : t("portal.expansion.messages.send")}
      </Button>
    </form>
  );
}
