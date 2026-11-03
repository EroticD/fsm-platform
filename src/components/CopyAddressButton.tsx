"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/icons";

type CopyState = "idle" | "copied" | "failed";

/**
 * Kopierer en adresse med Clipboard API. Knappen har egen status både visuelt
 * og i en `aria-live`-region, og gir en tydelig feil når nettleseren nekter.
 */
export default function CopyAddressButton({
  value,
  label,
  copiedLabel,
  failedLabel,
  className,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  failedLabel: string;
  className?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no-clipboard");
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 3000);
  }

  const status =
    state === "copied"
      ? copiedLabel
      : state === "failed"
        ? failedLabel
        : "";

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition ${className || ""}`}
      >
        <Icon
          name={state === "copied" ? "check" : "file"}
          className="h-3.5 w-3.5"
        />
        <span>
          {state === "copied"
            ? copiedLabel
            : state === "failed"
              ? failedLabel
              : label}
        </span>
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
    </>
  );
}
