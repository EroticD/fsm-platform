"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";

type ToastTone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: ToastTone };

type ToastFn = ((message: string, tone?: ToastTone) => void) & {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<{
  toast: ToastFn;
} | null>(null);

const MAX_TOASTS = 3;
const DEFAULT_DURATION = 4000;
const ERROR_DURATION = 8000;

let nextId = 1;

const noop = () => undefined;
const noopToast: ToastFn = Object.assign(noop, {
  success: noop,
  error: noop,
  info: noop,
});

function ToastItem({
  item,
  onDismiss,
}: {
  item: Toast;
  onDismiss: (id: number) => void;
}) {
  const t = useTranslations("common");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const remainingRef = useRef(
    item.tone === "error" ? ERROR_DURATION : DEFAULT_DURATION,
  );

  // Timeren pauses ved hover/fokus, og gjenopptas med resterende tid.
  useEffect(() => {
    if (paused) return;

    const startedAt = Date.now();
    const timer = window.setTimeout(() => {
      onDismiss(item.id);
    }, remainingRef.current);

    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (Date.now() - startedAt),
      );
    };
  }, [item.id, onDismiss, paused]);

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-bold shadow-lg ${
        item.tone === "success"
          ? "border-green-200 bg-green-50 text-green-900"
          : item.tone === "error"
            ? "border-red-200 bg-red-50 text-red-900"
            : "border-gray-200 bg-white text-gray-900"
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        ) {
          setFocused(false);
        }
      }}
    >
      <p className="flex-1">{item.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label={t("components.toast.dismiss")}
        className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base leading-none opacity-70 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}

/** Enkel toast-region med aria-live, uten eksterne avhengigheter. */
export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId++;
    setToasts((current) => {
      // Identiske varsler slås sammen; ny id restarter timeren.
      const withoutDuplicate = current.filter(
        (item) => item.tone !== tone || item.message !== message,
      );
      return [...withoutDuplicate, { id, message, tone }].slice(-MAX_TOASTS);
    });
  }, []);

  const toast = useMemo<ToastFn>(
    () =>
      Object.assign(
        (message: string, tone: ToastTone = "info") =>
          pushToast(message, tone),
        {
          success: (message: string) => pushToast(message, "success"),
          error: (message: string) => pushToast(message, "error"),
          info: (message: string) => pushToast(message, "info"),
        },
      ),
    [pushToast],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  const politeToasts = toasts.filter((item) => item.tone !== "error");
  const errorToasts = toasts.filter((item) => item.tone === "error");

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)_+_5.5rem)] z-[70] flex w-[min(92vw,22rem)] flex-col sm:bottom-[calc(env(safe-area-inset-bottom,0px)_+_1rem)]">
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-2"
        >
          {politeToasts.map((item) => (
            <ToastItem key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>
        <div
          role="alert"
          aria-live="assertive"
          className={`flex flex-col gap-2 ${
            errorToasts.length > 0 ? "mt-2" : ""
          }`}
        >
          {errorToasts.map((item) => (
            <ToastItem key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Komponenter kan brukes utenfor provideren i tester; da er toast en no-op.
    return { toast: noopToast };
  }
  return context;
}
