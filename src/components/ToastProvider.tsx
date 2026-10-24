"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ToastTone = "success" | "error" | "info";
type Toast = { id: number; message: string; tone: ToastTone };

const ToastContext = createContext<{
  toast: (message: string, tone?: ToastTone) => void;
} | null>(null);

let nextId = 1;

/** Enkel toast-region med aria-live, uten eksterne avhengigheter. */
export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    const id = nextId++;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-[min(92vw,22rem)] flex-col gap-2"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm font-bold shadow-lg ${
              item.tone === "success"
                ? "border-green-200 bg-green-50 text-green-900"
                : item.tone === "error"
                  ? "border-red-200 bg-red-50 text-red-900"
                  : "border-gray-200 bg-white text-gray-900"
            }`}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Komponenter kan brukes utenfor provideren i tester; da er toast en no-op.
    return { toast: () => undefined };
  }
  return context;
}
