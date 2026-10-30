import { CUSTOMER_CARD, CUSTOMER_MUTED } from "./customerStyles";

/** Felles fane-innpakning med tittel og beskrivelse. */
export default function CustomerTabPanel({
  title,
  description,
  children,
}: {
  title: React.ReactNode;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`${CUSTOMER_CARD} space-y-4 p-4 [--focus-ring:var(--ink,#101310)] sm:p-5`}
    >
      <div className="border-b border-[var(--line,#dedcd1)] pb-3">
        <h2 className="flex min-w-0 items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--ink,#101310)]">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)]"
          />
          <span className="min-w-0">{title}</span>
        </h2>
        {description ? (
          <p className={`mt-1 max-w-3xl text-xs leading-5 ${CUSTOMER_MUTED}`}>
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
