import type { ReactNode } from "react";

/**
 * Felles sidehode med tittel, undertittel og handlinger. Hode og innhold
 * ligger på samme papirflate som kortene, med en tynn signallinje øverst.
 */
export default function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`office-card relative overflow-hidden rounded-card border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-5 py-5 shadow-[0_1px_2px_rgba(20,17,11,0.05)] [--focus-ring:var(--ink,#101310)] sm:px-6 ${className}`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 bg-[var(--signal,#d8ff3e)]"
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-lg text-[var(--ink,#101310)]"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)] sm:text-3xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted,#62685f)]">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </header>
  );
}
