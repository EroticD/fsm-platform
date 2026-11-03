"use client";

import { useActionState, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import type { ScimTokenActionState } from "@/app/innstillinger/scim-actions";

const INITIAL_STATE: ScimTokenActionState = { status: "idle" };
const ROTATE_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] disabled:cursor-wait";

const ERROR_KEYS: Record<string, string> = {
  forbidden: "settings.ssoScim.errors.forbidden",
  validation_error: "settings.ssoScim.errors.invalid",
  not_found: "settings.ssoScim.errors.not_found",
  server_error: "settings.ssoScim.errors.error",
};

/** Roterer et SCIM-token og viser det nye tokenet én gang. */
export default function RotateScimTokenForm({
  id,
  name,
  rotateToken,
}: {
  id: string;
  name: string;
  rotateToken: (
    state: ScimTokenActionState,
    formData: FormData,
  ) => Promise<ScimTokenActionState>;
}) {
  const t = useTranslations("common");
  const [state, formAction, pending] = useActionState(
    rotateToken,
    INITIAL_STATE,
  );
  const tokenRef = useRef<HTMLInputElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  const token = state.status === "created" && !dismissed ? state.token : null;

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      tokenRef.current?.select();
    }
  }

  if (token) {
    return (
      <div
        role="status"
        className="mt-3 rounded-xl border border-[#e2cf9b] border-l-4 border-l-[var(--signal,#d8ff3e)] bg-[var(--paper,#f2efe6)] p-3"
      >
        <p className="text-xs font-extrabold text-[var(--ink,#101310)]">
          {t("settings.ssoScim.rotatedTitle", { name })}
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-xs font-bold text-[#6b4a05]">
          <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
          {t("settings.ssoScim.createdWarning")}
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            ref={tokenRef}
            readOnly
            value={token}
            aria-label={t("settings.ssoScim.copy")}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 font-mono text-xs text-[var(--ink,#101310)]"
          />
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={copyToken}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)]"
            >
              <Icon name="clipboard" className="h-4 w-4 shrink-0" />
              {copied
                ? t("settings.ssoScim.copied")
                : t("settings.ssoScim.copy")}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--line,#dedcd1)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]"
            >
              {t("settings.ssoScim.done")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2">
      {state.status === "error" && state.error && (
        <p
          role="alert"
          className="mb-2 text-xs font-bold text-[var(--risk-text,#b42318)]"
        >
          {t(ERROR_KEYS[state.error] ?? "settings.ssoScim.errors.error")}
        </p>
      )}
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" disabled={pending} className={ROTATE_BUTTON}>
          <Icon name="sync" className="mr-1 h-4 w-4 shrink-0" />
          {pending
            ? t("settings.ssoScim.rotating")
            : t("settings.ssoScim.rotate")}
        </button>
      </form>
    </div>
  );
}
