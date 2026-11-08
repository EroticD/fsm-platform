"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";

type PushStatus = {
  providers: {
    fcm: { configured: boolean; projectId: string | null };
    apns: {
      configured: boolean;
      bundleId: string | null;
      environment: "production" | "sandbox";
    };
  };
  devices: { total: number; active: number; stale: number };
  queue: { pending: number; deadLetter: number; sent24h: number };
  staleDays: number;
  lastSentAt: string | null;
};

type TestResult = {
  queued: number;
  sent: number;
  skipped: number;
  configured: boolean;
};

const CARD = "office-card space-y-4 p-4 sm:p-5";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--ink,#101310)] px-3 py-2 text-xs font-bold text-[var(--paper,#f2efe6)] disabled:cursor-wait disabled:opacity-60";
const INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] disabled:cursor-wait disabled:opacity-60";
const LABEL =
  "text-xs font-bold uppercase tracking-wide text-[var(--muted,#62685f)]";
const MUTED = "text-xs text-[var(--muted,#62685f)]";

class PushStatusError extends Error {
  constructor(readonly code: string | undefined) {
    super("push-status");
  }
}

async function requestStatus(): Promise<PushStatus> {
  const response = await fetch("/api/innstillinger/push", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => null)) as
    | ({ ok?: boolean; error?: string } & Partial<PushStatus>)
    | null;
  if (!response.ok || !payload?.ok) {
    throw new PushStatusError(payload?.error);
  }
  return payload as PushStatus;
}

function errorKey(code: string | null | undefined): string {
  if (code === "forbidden") return "push.settings.errorForbidden";
  if (code === "rate-limited") return "push.settings.errorRateLimited";
  if (code === "unauthenticated") return "push.settings.errorUnauthenticated";
  return "push.settings.error";
}

/**
 * Administrasjon av pushvarsler. Viser bare om leverandørene er konfigurert,
 * aldri hemmeligheter eller tokens. Testvarselet går til administratorens egne
 * registrerte enheter, og oppryddingen sletter deaktiverte/foreldede enheter.
 */
export default function PushSettingsTab() {
  const t = useTranslations("common");
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"test" | "cleanup" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [cleanupResult, setCleanupResult] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await requestStatus());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof PushStatusError
          ? errorKey(caught.code)
          : "push.settings.loadError",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const initial = async () => {
      try {
        const next = await requestStatus();
        if (!active) return;
        setStatus(next);
        setError(null);
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof PushStatusError
            ? errorKey(caught.code)
            : "push.settings.loadError",
        );
      } finally {
        if (active) setLoading(false);
      }
    };
    void initial();
    return () => {
      active = false;
    };
  }, []);

  async function sendTest() {
    setBusy("test");
    setError(null);
    setTestResult(null);
    try {
      const response = await fetch("/api/innstillinger/push/test", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => null)) as
        | ({ ok?: boolean; error?: string } & Partial<TestResult>)
        | null;
      if (!response.ok || !payload?.ok) {
        setError(errorKey(payload?.error));
        return;
      }
      setTestResult({
        queued: payload.queued ?? 0,
        sent: payload.sent ?? 0,
        skipped: payload.skipped ?? 0,
        configured: Boolean(payload.configured),
      });
      await load();
    } catch {
      setError("push.settings.error");
    } finally {
      setBusy(null);
    }
  }

  async function clearStale() {
    setBusy("cleanup");
    setError(null);
    setCleanupResult(null);
    try {
      const response = await fetch("/api/innstillinger/push/cleanup", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; deleted?: number }
        | null;
      if (!response.ok || !payload?.ok) {
        setError(errorKey(payload?.error));
        return;
      }
      setCleanupResult(payload.deleted ?? 0);
      await load();
    } catch {
      setError("push.settings.error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-[#e7b5ae] bg-[#fbe9e7] p-3 text-sm font-bold text-[var(--risk-text,#b42318)]"
        >
          {t(error)}
        </p>
      )}

      <section className={CARD}>
        <div className="flex items-start gap-3">
          <Icon name="bell" className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-[var(--ink,#101310)]">
              {t("push.settings.title")}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted,#62685f)]">
              {t("push.settings.description")}
            </p>
          </div>
        </div>

        <p className={MUTED}>{t("push.settings.noSecrets")}</p>

        {loading && !status ? (
          <p className="text-sm text-[var(--muted,#62685f)]">
            {t("push.settings.loading")}
          </p>
        ) : status ? (
          <>
            <div>
              <h3 className="mb-2 text-sm font-extrabold text-[var(--ink,#101310)]">
                {t("push.settings.providersTitle")}
              </h3>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--line,#dedcd1)] p-3">
                  <dt className={LABEL}>{t("push.settings.fcm")}</dt>
                  <dd className="mt-1 font-bold text-[var(--ink,#101310)]">
                    {status.providers.fcm.configured
                      ? t("push.settings.configured")
                      : t("push.settings.notConfigured")}
                  </dd>
                  {status.providers.fcm.configured &&
                    status.providers.fcm.projectId && (
                      <dd className={MUTED}>
                        {t("push.settings.project", {
                          project: status.providers.fcm.projectId,
                        })}
                      </dd>
                    )}
                </div>
                <div className="rounded-xl border border-[var(--line,#dedcd1)] p-3">
                  <dt className={LABEL}>{t("push.settings.apns")}</dt>
                  <dd className="mt-1 font-bold text-[var(--ink,#101310)]">
                    {status.providers.apns.configured
                      ? t("push.settings.configured")
                      : t("push.settings.notConfigured")}
                  </dd>
                  {status.providers.apns.configured && (
                    <dd className={MUTED}>
                      {t("push.settings.environment", {
                        environment:
                          status.providers.apns.environment === "sandbox"
                            ? t("push.settings.sandbox")
                            : t("push.settings.production"),
                      })}
                    </dd>
                  )}
                </div>
              </dl>
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--line,#dedcd1)] p-3">
                <p className={LABEL}>{t("push.settings.devicesTitle")}</p>
                <p className="mt-1 font-bold text-[var(--ink,#101310)]">
                  {t("push.settings.devicesActive", {
                    active: status.devices.active,
                    total: status.devices.total,
                  })}
                </p>
                <p className={MUTED}>
                  {t("push.settings.devicesStale", {
                    count: status.devices.stale,
                    days: status.staleDays,
                  })}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--line,#dedcd1)] p-3">
                <p className={LABEL}>{t("push.settings.queueTitle")}</p>
                <p className="mt-1 font-bold text-[var(--ink,#101310)]">
                  {t("push.settings.queuePending", {
                    count: status.queue.pending,
                  })}
                </p>
                <p className={MUTED}>
                  {t("push.settings.queueDeadLetter", {
                    count: status.queue.deadLetter,
                  })}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--line,#dedcd1)] p-3">
                <p className={LABEL}>{t("push.settings.sentTitle")}</p>
                <p className="mt-1 font-bold text-[var(--ink,#101310)]">
                  {t("push.settings.queueSent", {
                    count: status.queue.sent24h,
                  })}
                </p>
                <p className={MUTED}>
                  {status.lastSentAt
                    ? t("push.settings.lastSent", {
                        time: new Date(status.lastSentAt).toLocaleString(),
                      })
                    : t("push.settings.neverSent")}
                </p>
              </div>
            </div>
          </>
        ) : null}
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
          {t("push.settings.testTitle")}
        </h3>
        <p className="text-sm text-[var(--muted,#62685f)]">
          {t("push.settings.testDescription")}
        </p>
        <div>
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={busy !== null}
            className={BUTTON}
          >
            <Icon name="sync" className="h-4 w-4" />
            {busy === "test" ? t("push.settings.sending") : t("push.settings.sendTest")}
          </button>
        </div>
        {testResult && (
          <p className="rounded-xl border border-[#b9c99a] bg-[#eef7d6] p-3 text-sm font-bold text-[#283509]">
            {!testResult.configured
              ? t("push.settings.testNotConfigured")
              : testResult.queued === 0
                ? t("push.settings.testNoDevices")
                : t("push.settings.testSent", {
                    sent: testResult.sent,
                    queued: testResult.queued,
                  })}
          </p>
        )}
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-extrabold text-[var(--ink,#101310)]">
          {t("push.settings.cleanupTitle")}
        </h3>
        <p className="text-sm text-[var(--muted,#62685f)]">
          {t("push.settings.cleanupDescription", { days: 90 })}
        </p>
        <div>
          <button
            type="button"
            onClick={() => void clearStale()}
            disabled={busy !== null}
            className={INK_BUTTON}
          >
            <Icon name="trash" className="h-4 w-4" />
            {busy === "cleanup"
              ? t("push.settings.cleaning")
              : t("push.settings.cleanup")}
          </button>
        </div>
        {cleanupResult !== null && (
          <p className="rounded-xl border border-[#b9c99a] bg-[#eef7d6] p-3 text-sm font-bold text-[#283509]">
            {t("push.settings.cleanupResult", { count: cleanupResult })}
          </p>
        )}
      </section>
    </div>
  );
}
