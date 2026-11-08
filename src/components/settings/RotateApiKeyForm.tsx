"use client";

import { useActionState, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import type { ApiKeyActionState } from "@/app/innstillinger/api-actions";

const INITIAL_STATE: ApiKeyActionState = { status: "idle" };

const ROTATE_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] disabled:cursor-wait";

const ERROR_KEYS: Record<string, string> = {
  forbidden: "settings.apiKeys.errors.forbidden",
  validation_error: "settings.apiKeys.errors.invalid",
  not_found: "settings.apiKeys.errors.not_found",
  server_error: "settings.apiKeys.errors.error",
};

/**
 * Rullerer en nøkkel og viser det nye tokenet én gang. Det gamle tokenet
 * tilbakekalles i samme operasjon, så en integrasjon må bytte nøkkel med en
 * gang. Klarteksttokenet holdes bare i React-tilstanden.
 */
export default function RotateApiKeyForm({
  id,
  name,
  rotateKey,
}: {
  id: string;
  name: string;
  rotateKey: (
    state: ApiKeyActionState,
    formData: FormData,
  ) => Promise<ApiKeyActionState>;
}) {
  const t = useTranslations("common");
  const [state, formAction, pending] = useActionState(
    rotateKey,
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
          {t("settings.apiKeys.rotatedTitle", { name })}
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-xs font-bold text-[var(--warning-text,#7a4f0c)]">
          <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
          {t("settings.apiKeys.createdWarning")}
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            ref={tokenRef}
            readOnly
            value={token}
            aria-label={t("settings.apiKeys.copy")}
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
                ? t("settings.apiKeys.copied")
                : t("settings.apiKeys.copy")}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--line,#dedcd1)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]"
            >
              {t("settings.apiKeys.done")}
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
          {t(ERROR_KEYS[state.error] ?? "settings.apiKeys.errors.error")}
        </p>
      )}
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" disabled={pending} className={ROTATE_BUTTON}>
          <Icon name="sync" className="mr-1 h-4 w-4 shrink-0" />
          {pending
            ? t("settings.apiKeys.rotating")
            : t("settings.apiKeys.rotate")}
        </button>
      </form>
    </div>
  );
}
