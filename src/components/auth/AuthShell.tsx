import type { ReactNode } from "react";
import PageShell from "@/components/PageShell";
import Card from "@/components/ui/Card";
import ErrorBanner from "@/components/ErrorBanner";
import Icon, { type IconName } from "@/components/icons";

/**
 * Felles ramme for innlogging, passord og kontobekreftelse. Alle auth-sidene
 * deler samme sentrerte papirkort, signallinje og typografi, slik at de ikke
 * driver fra hverandre når én av dem justeres.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <PageShell className="flex min-h-screen items-center justify-center">
      <Card className="relative w-full max-w-md overflow-hidden p-6 sm:p-8">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1.5 bg-[var(--signal,#d8ff3e)]"
        />
        {children}
      </Card>
    </PageShell>
  );
}

/** Felles tittelblokk. `mark` brukes der merkevaren skal vises i stedet for ikon. */
export function AuthHeader({
  icon,
  mark,
  title,
  description,
  tone = "ink",
}: {
  icon?: IconName;
  mark?: ReactNode;
  title: string;
  description?: ReactNode;
  tone?: "ink" | "risk";
}) {
  const isRisk = tone === "risk";

  return (
    <div className="mb-6 flex flex-col items-center text-center">
      {mark ? (
        <div className="mb-3">{mark}</div>
      ) : icon ? (
        <div
          className={`relative mb-3 flex h-12 w-12 items-center justify-center rounded-xl ${
            isRisk
              ? "border border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] text-[var(--risk-text,#b42318)]"
              : "border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)] shadow-[2px_2px_0_var(--signal,#d8ff3e)]"
          }`}
        >
          <Icon name={icon} className="h-5 w-5" />
          {!isRisk && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)]"
            />
          )}
        </div>
      ) : null}
      <h1
        className={`type-title-2 ${
          isRisk
            ? "text-[var(--risk-text,#b42318)]"
            : "text-[var(--ink,#101310)]"
        }`}
      >
        {title}
      </h1>
      {description && (
        <div className="type-ui mt-1 leading-6 text-[var(--muted,#62685f)]">
          {description}
        </div>
      )}
    </div>
  );
}

/**
 * Feil og advarsler i auth-skjemaene. Risiko bruker den felles ErrorBanner,
 * advarsel ligger på warning-tokenene slik at fargene følger temaet.
 */
export function AuthAlert({
  message,
  tone = "risk",
}: {
  message: string;
  tone?: "risk" | "warning";
}) {
  if (tone === "risk") {
    return <ErrorBanner message={message} className="mb-4" />;
  }

  return (
    <div
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warning-text,#7a4f0c)_22%,transparent)] bg-[var(--warning-surface,#fdf5e4)] px-3 py-2 text-sm font-bold text-[var(--warning-text,#7a4f0c)]"
    >
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
