import type { ReactNode } from "react";
import {
  isScannerAlert,
  type ScannerNoticeKind,
} from "@/lib/scanner-capability";

export type { ScannerNoticeKind };

/**
 * Presentasjonskomponent for skannerens tilstander. Den er bevisst uten
 * hooks, slik at feil- og reservevisningene kan rendres og testes i node.
 */
export default function ScannerNotice({
  kind,
  children,
}: {
  kind: ScannerNoticeKind;
  children?: ReactNode;
}) {
  if (!children) return null;
  const isAlert = isScannerAlert(kind);
  return (
    <div
      role={isAlert ? "alert" : "status"}
      aria-live={isAlert ? "assertive" : "polite"}
      data-scanner-state={kind}
      className={`rounded-2xl border-2 px-4 py-3 text-sm font-bold ${
        isAlert
          ? "border-risk/50 bg-risk/10 text-risk"
          : "border-signal/40 bg-signal/10 text-paper"
      }`}
    >
      {children}
    </div>
  );
}
