import type { ReactNode } from "react";
import Card from "@/components/ui/Card";

/** Kort seksjon med tittel og valgfri beskrivelse/handling. */
export default function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      as="section"
      className={`p-5 [--focus-ring:var(--ink,#101310)] sm:p-6 ${className}`}
    >
      {(title || action) && (
        <div className="mb-5 flex flex-col gap-3 border-b border-[var(--line,#dedcd1)] pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {title && (
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
                />
                <span className="min-w-0">{title}</span>
              </h2>
            )}
            {description && (
              <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </Card>
  );
}
