import type { ReactNode } from "react";

/**
 * Felles kontorramme. Eier bakgrunn, maksbredde, luft og vertikal rytme, slik
 * at hver side slipper å duplisere `office-app office-page`.
 */
export default function PageShell({
  children,
  size = "wide",
  className = "",
}: {
  children: ReactNode;
  size?: "wide" | "narrow";
  className?: string;
}) {
  return (
    <div
      className={`office-app office-page ${
        size === "narrow" ? "office-page-narrow" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}
