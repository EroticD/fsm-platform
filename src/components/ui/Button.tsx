import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  // Lime er alltid en signalflate med blekksvart tekst, aldri hvit tekst.
  primary:
    "signal-button border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--ink,#101310)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
  secondary:
    "border border-[var(--ink,#101310)] bg-transparent text-[var(--ink,#101310)] hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]",
  ghost:
    "text-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]",
  danger:
    "border border-[var(--risk,#f04427)] bg-[var(--risk,#f04427)] text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] hover:bg-[#d33218]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3",
  md: "px-4",
};

/**
 * Felles knapp med 44 px minste trykkflate. `pending` deaktiverer knappen og
 * markerer den som opptatt, slik at skjemaer ikke kan sendes to ganger.
 */
export default function Button({
  variant = "primary",
  size = "md",
  pending = false,
  disabled,
  className = "",
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pending?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] text-sm font-bold transition [--focus-ring:var(--ink,#101310)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {pending && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
