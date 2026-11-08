import type { ReactNode } from "react";
import Icon from "@/components/icons";

/**
 * Tom tilstand med en tydelig handling, i stedet for en tom liste.
 *
 * `variant="plain"` fjerner egen ramme og bakgrunn, slik at tilstanden kan
 * ligge inne i et kort uten å bli et kort i kortet.
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "card",
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "card" | "plain";
}) {
  const surface =
    variant === "card"
      ? "border border-dashed border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)]"
      : "";

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl px-6 py-10 text-center [--focus-ring:var(--ink,#101310)] ${surface}`}
    >
      <span
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)] text-[var(--ink,#101310)]"
      >
        {icon ?? <Icon name="folder" className="h-6 w-6" />}
      </span>
      <h2 className="type-title-3 mt-3 text-[var(--ink,#101310)]">{title}</h2>
      {description && (
        <p className="type-meta mt-1 max-w-md text-[var(--muted,#62685f)]">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
