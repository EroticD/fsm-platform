"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import type { ScimTokenActionState } from "@/app/innstillinger/scim-actions";

const INITIAL_STATE: ScimTokenActionState = { status: "idle" };
const FIELD = controlClassName("min-h-11 text-sm font-medium");
const LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[var(--muted,#62685f)]";
const SIGNAL_BUTTON =
  "signal-button w-full text-xs shadow-[2px_2px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)] disabled:cursor-wait sm:w-auto";

const ERROR_KEYS: Record<string, string> = {
  forbidden: "settings.ssoScim.errors.forbidden",
  validation_error: "settings.ssoScim.errors.invalid",
  not_found: "settings.ssoScim.errors.not_found",
  server_error: "settings.ssoScim.errors.error",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function maxExpiryIso(maxDays: number): string {
  return new Date(Date.now() + maxDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Oppretter et SCIM-token og viser klarteksttokenet nøyaktig én gang. Tokenet
 * holdes bare i React-tilstanden og havner aldri i URL, cookie eller lager.
 */
export default function CreateScimTokenForm({
  createToken,
  defaultLifetimeDays,
  maxLifetimeDays,
}: {
  createToken: (
    state: ScimTokenActionState,
    formData: FormData,
  ) => Promise<ScimTokenActionState>;
  defaultLifetimeDays: number;
  maxLifetimeDays: number;
}) {
  const t = useTranslations("common");
  const formRef = useRef<HTMLFormElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(
    createToken,
    INITIAL_STATE,
  );
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const token =
    state.status === "created" && state.token !== dismissedToken
      ? state.token
      : null;

  useEffect(() => {
    if (state.status === "created") formRef.current?.reset();
  }, [state.status, state.token]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      tokenRef.current?.select();
    }
  }

  return (
    <div className="space-y-4">
      {token && (
        <div
          role="status"
          className="rounded-xl border border-[#e2cf9b] border-l-4 border-l-[var(--signal,#d8ff3e)] bg-[var(--paper,#f2efe6)] p-4"
        >
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-[var(--ink,#101310)]">
            <Icon name="check" className="h-4 w-4 shrink-0" />
            {t("settings.ssoScim.createdTitle")}
            {state.tokenName ? ` · ${state.tokenName}` : ""}
          </h3>
          <p className="mt-1.5 flex items-start gap-1.5 text-xs font-bold text-[var(--warning-text,#7a4f0c)]">
            <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
            {t("settings.ssoScim.createdWarning")}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              ref={tokenRef}
              readOnly
              value={token}
              aria-label={t("settings.ssoScim.copy")}
              onFocus={(event) => event.currentTarget.select()}
              className="min-h-11 w-full min-w-0 rounded-lg border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 font-mono text-xs text-[var(--ink,#101310)]"
            />
            <div className="flex shrink-0 flex-wrap gap-2">
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
                onClick={() => setDismissedToken(token)}
                className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--line,#dedcd1)] px-3 py-2 text-xs font-bold text-[var(--ink,#101310)]"
              >
                {t("settings.ssoScim.done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {state.status === "error" && state.error && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] px-4 py-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          {t(ERROR_KEYS[state.error] ?? "settings.ssoScim.errors.error")}
        </div>
      )}

      <form ref={formRef} action={formAction} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL}>{t("settings.ssoScim.name")}</span>
            <input
              type="text"
              name="name"
              required
              maxLength={80}
              autoComplete="off"
              placeholder={t("settings.ssoScim.namePlaceholder")}
              className={FIELD}
            />
          </label>
          <label className="block">
            <span className={LABEL}>{t("settings.ssoScim.expiresAt")}</span>
            <input
              type="date"
              name="expiresAt"
              min={todayIso()}
              max={maxExpiryIso(maxLifetimeDays)}
              className={FIELD}
            />
          </label>
        </div>
        <p className="text-xs text-[var(--muted,#62685f)]">
          {t("settings.ssoScim.expiresHint", { days: defaultLifetimeDays })}
        </p>
        <button type="submit" disabled={pending} className={SIGNAL_BUTTON}>
          {pending
            ? t("settings.ssoScim.creating")
            : t("settings.ssoScim.create")}
        </button>
      </form>
    </div>
  );
}
