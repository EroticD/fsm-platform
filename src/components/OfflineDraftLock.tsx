"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslations } from "next-intl";
import Icon from "@/components/icons";
import { OUTBOX_CHANGED_EVENT } from "@/lib/offline/draft-outbox";
import {
  changeOfflinePinForUser,
  discardLegacyOfflineDrafts,
  discardOfflineDraftsAndKey,
  getOfflineLockStatus,
  isOfflinePinError,
  lockOfflineDrafts,
  OFFLINE_LOCK_EVENT,
  OFFLINE_UNLOCK_REQUEST_EVENT,
  OfflineLockedError,
  PIN_MIN_LENGTH,
  setupOfflinePin,
  unlockOfflineDrafts,
  validateNewPin,
  type OfflineLockStatus,
  type PinValidation,
} from "@/lib/offline/lock";
import {
  OfflineCryptoUnavailableError,
  OfflineKeyCorruptError,
  OfflineKeyMissingError,
} from "@/lib/offline/crypto";

type Mode = "setup" | "unlock" | "change";

/**
 * Låsepanel for offline-kladder.
 *
 * Panelet vises bare når det er noe brukeren må forholde seg til: en låst
 * nøkkel, kladder fra før kryptering ble innført, eller et ønske om å sette PIN
 * mens brukeren er offline. Det kan også åpnes fra skjemaet via
 * `OFFLINE_UNLOCK_REQUEST_EVENT`.
 */
export default function OfflineDraftLock({
  userId,
}: {
  userId?: string | null;
}) {
  const t = useTranslations("common");
  const [status, setStatus] = useState<OfflineLockStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<Mode>("unlock");
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const pinId = `${formId}-pin`;
  const confirmId = `${formId}-confirm`;
  const currentId = `${formId}-current`;
  const errorId = `${formId}-error`;
  const hintId = `${formId}-hint`;

  const online = useSyncExternalStore(
    (callback) => {
      window.addEventListener("online", callback);
      window.addEventListener("offline", callback);
      return () => {
        window.removeEventListener("online", callback);
        window.removeEventListener("offline", callback);
      };
    },
    () => navigator.onLine,
    () => true,
  );

  const refresh = useCallback(async () => {
    if (!userId) {
      setStatus(null);
      return;
    }
    try {
      setStatus(await getOfflineLockStatus(userId));
    } catch {
      setStatus(null);
    }
  }, [userId]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const onLock = () => void refresh();
    const onOutbox = () => void refresh();
    const onUnlockRequest = () => {
      setExpanded(true);
      setError(null);
      void refresh();
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith("fsm:offline")) void refresh();
    };
    window.addEventListener(OFFLINE_LOCK_EVENT, onLock);
    window.addEventListener(OUTBOX_CHANGED_EVENT, onOutbox);
    window.addEventListener(OFFLINE_UNLOCK_REQUEST_EVENT, onUnlockRequest);
    window.addEventListener("storage", onStorage);
    // Inaktivitetslåsen skjer uten en hendelse. En lett polling sørger for at
    // banneret forsvinner og blir til et opplåsingsfelt når grensen passeres.
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => {
      window.removeEventListener(OFFLINE_LOCK_EVENT, onLock);
      window.removeEventListener(OUTBOX_CHANGED_EVENT, onOutbox);
      window.removeEventListener(OFFLINE_UNLOCK_REQUEST_EVENT, onUnlockRequest);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    if (!expanded) return;
    const target =
      mode === "change" && status?.hasKey
        ? document.getElementById(currentId)
        : pinRef.current;
    target?.focus();
  }, [expanded, mode, status?.hasKey, currentId]);

  const resetFields = () => {
    setPin("");
    setConfirmation("");
    setCurrentPin("");
    setError(null);
  };

  const openMode = (next: Mode) => {
    setMode(next);
    setExpanded(true);
    setMessage(null);
    resetFields();
  };

  const validationMessage = (validation: PinValidation): string => {
    if (validation.ok) return "";
    switch (validation.reason) {
      case "mismatch":
        return t("p3.offlineLock.pinMismatch");
      case "too-short":
      case "empty":
        return t("p3.offlineLock.pinTooShort", { min: PIN_MIN_LENGTH });
      default:
        return t("p3.offlineLock.pinInvalid");
    }
  };

  const handleError = (caught: unknown) => {
    if (isOfflinePinError(caught)) {
      if (caught.code === "locked") {
        const seconds = Math.max(
          1,
          Math.ceil((caught.lockedUntil - Date.now()) / 1000),
        );
        setError(t("p3.offlineLock.lockedOut", { seconds }));
      } else {
        setError(
          t("p3.offlineLock.wrongPin", {
            remaining: caught.remainingAttempts,
          }),
        );
      }
      return;
    }
    if (caught instanceof OfflineKeyCorruptError) {
      setError(t("p3.offlineLock.keyCorrupt"));
      return;
    }
    if (caught instanceof OfflineKeyMissingError) {
      setError(t("p3.offlineLock.keyMissing"));
      return;
    }
    if (caught instanceof OfflineCryptoUnavailableError) {
      setError(t("p3.offlineLock.cryptoUnavailable"));
      return;
    }
    if (caught instanceof OfflineLockedError) {
      setError(t("p3.offlineLock.lockedDescription"));
      return;
    }
    setError(t("p3.offlineLock.cryptoUnavailable"));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!userId || busy) return;
    setError(null);
    setMessage(null);

    const activeMode: Mode =
      mode === "change" && status?.hasKey
        ? "change"
        : status?.hasKey
          ? "unlock"
          : "setup";

    if (activeMode === "change") {
      const validation = validateNewPin(pin, confirmation);
      if (!validation.ok) {
        setError(validationMessage(validation));
        return;
      }
      setBusy(true);
      try {
        await changeOfflinePinForUser(userId, currentPin, pin);
        resetFields();
        setMode("unlock");
        setMessage(t("p3.offlineLock.changeSuccess"));
        await refresh();
      } catch (caught) {
        handleError(caught);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (activeMode === "setup") {
      const validation = validateNewPin(pin, confirmation);
      if (!validation.ok) {
        setError(validationMessage(validation));
        return;
      }
      setBusy(true);
      try {
        const result = await setupOfflinePin(userId, pin);
        resetFields();
        setExpanded(false);
        setMessage(
          result.drafts + result.outbox > 0
            ? t("p3.offlineLock.migrated", {
                count: result.drafts + result.outbox,
              })
            : t("p3.offlineLock.unlockedStatus"),
        );
        await refresh();
      } catch (caught) {
        handleError(caught);
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const result = await unlockOfflineDrafts(userId, pin);
      resetFields();
      setExpanded(false);
      setMessage(
        result.drafts + result.outbox > 0
          ? t("p3.offlineLock.migrated", {
              count: result.drafts + result.outbox,
            })
          : t("p3.offlineLock.unlockedStatus"),
      );
      await refresh();
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  };

  const lockNow = async () => {
    if (!userId || busy) return;
    lockOfflineDrafts();
    setExpanded(false);
    resetFields();
    setMessage(null);
    await refresh();
  };

  const discard = async () => {
    if (!userId || busy) return;
    if (status && status.plaintext > 0 && !status.hasKey) {
      if (!window.confirm(t("p3.offlineLock.legacyDiscardConfirm"))) return;
      setBusy(true);
      try {
        await discardLegacyOfflineDrafts(userId);
        setExpanded(false);
        resetFields();
        await refresh();
      } catch (caught) {
        handleError(caught);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!window.confirm(t("p3.offlineLock.discardConfirm"))) return;
    setBusy(true);
    try {
      await discardOfflineDraftsAndKey(userId);
      setExpanded(false);
      resetFields();
      setMessage(null);
      await refresh();
    } catch (caught) {
      handleError(caught);
    } finally {
      setBusy(false);
    }
  };

  if (!userId || !status) return null;

  const total = status.drafts + status.outbox;
  // Krypterte poster uten nøkkel kan ikke gjenopprettes. Da skal brukeren få
  // et tydelig forkast-valg i stedet for et oppsett som ville latt dem ligge
  // ulåsbare for alltid.
  const orphaned = !status.hasKey && total > 0 && status.plaintext === 0;
  const needsSetup =
    !status.hasKey && !orphaned && (total > 0 || !online);
  const needsUnlock = status.hasKey && !status.unlocked && total > 0;
  const unlockedWithDrafts = status.hasKey && status.unlocked && total > 0;
  const legacy = status.plaintext > 0;
  // Kladd fra en eldre versjon: vis migreringsvalget med en gang, slik at
  // klartekst ikke blir liggende ubemerket.
  const autoExpanded = legacy && !status.hasKey;
  const formOpen = (expanded || autoExpanded) && !orphaned;
  const effectiveMode: Mode =
    mode === "change" && status.hasKey
      ? "change"
      : status.hasKey
        ? "unlock"
        : "setup";
  const visible =
    expanded ||
    orphaned ||
    legacy ||
    needsSetup ||
    needsUnlock ||
    unlockedWithDrafts;

  if (!status.supported) {
    if (!expanded) return null;
    return (
      <div
        role="status"
        className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-bold text-amber-950"
      >
        {t("p3.offlineLock.cryptoUnavailable")}
      </div>
    );
  }

  if (!visible) return null;

  const title = orphaned
    ? t("p3.offlineLock.orphanedTitle")
    : legacy
      ? t("p3.offlineLock.legacyTitle")
      : status.hasKey && !status.unlocked
        ? t("p3.offlineLock.lockedTitle")
        : status.hasKey
          ? t("p3.offlineLock.unlockedStatus")
          : t("p3.offlineLock.setupTitle");
  const description = orphaned
    ? t("p3.offlineLock.orphanedDescription")
    : legacy
      ? t("p3.offlineLock.legacyDescription")
      : status.hasKey && !status.unlocked
        ? t("p3.offlineLock.lockedDescription")
        : status.hasKey
          ? null
          : t("p3.offlineLock.setupDescription");

  return (
    <section
      aria-label={title}
      className="border-b border-blue-200 bg-blue-50/90 px-4 py-2 text-blue-950"
    >
      <div className="mx-auto max-w-3xl space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="flex items-center gap-1.5 text-xs font-black">
            <Icon name="shield" className="h-4 w-4 shrink-0" />
            <span>{title}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!status.hasKey && !orphaned && !formOpen && (
              <button
                type="button"
                onClick={() => openMode("setup")}
                className="rounded-lg border border-current px-2.5 py-1 text-xs font-black transition hover:bg-surface/60"
              >
                {legacy
                  ? t("p3.offlineLock.migrateAction")
                  : t("p3.offlineLock.setupAction")}
              </button>
            )}
            {status.hasKey && !status.unlocked && !formOpen && (
              <button
                type="button"
                onClick={() => openMode("unlock")}
                className="rounded-lg border border-current px-2.5 py-1 text-xs font-black transition hover:bg-surface/60"
              >
                {t("p3.offlineLock.unlockAction")}
              </button>
            )}
            {status.hasKey && status.unlocked && (
              <>
                <button
                  type="button"
                  onClick={() => void lockNow()}
                  disabled={busy}
                  className="rounded-lg border border-current px-2.5 py-1 text-xs font-black transition hover:bg-surface/60 disabled:opacity-60"
                >
                  {t("p3.offlineLock.lockAction")}
                </button>
                <button
                  type="button"
                  onClick={() => openMode("change")}
                  disabled={busy}
                  className="underline decoration-2 underline-offset-2 text-xs font-bold disabled:opacity-60"
                >
                  {t("p3.offlineLock.changeAction")}
                </button>
              </>
            )}
            {(legacy || orphaned || needsSetup || needsUnlock) && (
              <button
                type="button"
                onClick={() => void discard()}
                disabled={busy}
                className="underline decoration-2 underline-offset-2 text-xs font-bold opacity-80 hover:opacity-100 disabled:opacity-60"
              >
                {legacy && !status.hasKey
                  ? t("p3.offlineLock.legacyDiscardAction")
                  : t("p3.offlineLock.discardAction")}
              </button>
            )}
            {formOpen &&
              !orphaned &&
              !legacy &&
              !needsSetup &&
              !needsUnlock && (
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  resetFields();
                  setError(null);
                }}
                className="underline decoration-2 underline-offset-2 text-xs font-bold"
              >
                {t("p3.offlineLock.closeAction")}
              </button>
            )}
          </div>
        </div>

        {description && (
          <p className="text-xs leading-relaxed text-blue-900/90">
            {description}
          </p>
        )}

        {message && (
          <p role="status" aria-live="polite" className="text-xs font-bold">
            {message}
          </p>
        )}

        {formOpen && (
          <form
            onSubmit={(event) => void submit(event)}
            className="flex flex-wrap items-end gap-2"
            noValidate
          >
            {effectiveMode === "change" && (
              <div className="min-w-32 flex-1">
                <label
                  htmlFor={currentId}
                  className="mb-1 block text-2xs font-black uppercase tracking-wide"
                >
                  {t("p3.offlineLock.currentPinLabel")}
                </label>
                <input
                  id={currentId}
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  pattern="[0-9]*"
                  maxLength={12}
                  value={currentPin}
                  onChange={(event) =>
                    setCurrentPin(event.target.value.replace(/\D/g, ""))
                  }
                  aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
                  className="min-h-10 w-full rounded-lg border border-blue-300 bg-surface px-3 py-2 text-base font-bold tracking-widest text-blue-950"
                />
              </div>
            )}

            <div className="min-w-32 flex-1">
              <label
                htmlFor={pinId}
                className="mb-1 block text-2xs font-black uppercase tracking-wide"
              >
                {effectiveMode === "change"
                  ? t("p3.offlineLock.newPinLabel")
                  : t("p3.offlineLock.pinLabel")}
              </label>
              <input
                ref={pinRef}
                id={pinId}
                type="password"
                inputMode="numeric"
                autoComplete={
                  effectiveMode === "unlock" ? "current-password" : "new-password"
                }
                pattern="[0-9]*"
                maxLength={12}
                value={pin}
                onChange={(event) =>
                  setPin(event.target.value.replace(/\D/g, ""))
                }
                aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
                className="min-h-10 w-full rounded-lg border border-blue-300 bg-surface px-3 py-2 text-base font-bold tracking-widest text-blue-950"
              />
            </div>

            {effectiveMode !== "unlock" && (
              <div className="min-w-32 flex-1">
                <label
                  htmlFor={confirmId}
                  className="mb-1 block text-2xs font-black uppercase tracking-wide"
                >
                  {t("p3.offlineLock.pinConfirmLabel")}
                </label>
                <input
                  id={confirmId}
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  pattern="[0-9]*"
                  maxLength={12}
                  value={confirmation}
                  onChange={(event) =>
                    setConfirmation(event.target.value.replace(/\D/g, ""))
                  }
                  aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
                  className="min-h-10 w-full rounded-lg border border-blue-300 bg-surface px-3 py-2 text-base font-bold tracking-widest text-blue-950"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              aria-busy={busy}
              className="min-h-10 rounded-lg bg-blue-700 px-4 py-2 text-sm font-black text-white transition hover:bg-blue-800 disabled:opacity-60"
            >
              {effectiveMode === "change"
                ? t("p3.offlineLock.changeAction")
                : effectiveMode === "setup"
                  ? legacy
                    ? t("p3.offlineLock.migrateAction")
                    : t("p3.offlineLock.setupAction")
                  : t("p3.offlineLock.unlockAction")}
            </button>

            <p id={hintId} className="w-full text-2xs text-blue-900/75">
              {t("p3.offlineLock.pinHint", { min: PIN_MIN_LENGTH })}
            </p>
            {error && (
              <p
                id={errorId}
                role="alert"
                className="w-full text-xs font-bold text-red-700"
              >
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
