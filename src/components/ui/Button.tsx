import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "danger-outline";
export type ButtonSize = "sm" | "md";

/**
 * Felles knappestil, også for `<Link>` og `<summary>` der vi ikke kan bruke
 * `<Button>`. Alle varianter er 44 px i `md` og 36 px i `sm`; på berøringsskjerm
 * løfter den globale regelen i globals.css trykkflaten til 44 px.
 */
const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-bold leading-[1.2] transition [--focus-ring:var(--ink,#101310)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

const VARIANTS: Record<ButtonVariant, string> = {
  // Lime er alltid en signalflate med blekksvart tekst, aldri hvit tekst.
  primary:
    "border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--ink,#101310)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
  secondary:
    "border border-[var(--ink,#101310)] bg-transparent text-[var(--ink,#101310)] hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)]",
  ghost:
    "border border-transparent text-[var(--ink,#101310)] hover:bg-[var(--paper,#f2efe6)]",
  // Rød er alarmflate. Blekksvart tekst holder 5:1 også på liten knapp;
  // hvit tekst er bare tillatt på store, fete etiketter.
  danger:
    "border border-[var(--risk,#f04427)] bg-[var(--risk,#f04427)] text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] hover:bg-[color-mix(in_srgb,var(--risk,#f04427)_85%,var(--ink,#101310))]",
  "danger-outline":
    "border border-[var(--risk-text,#b42318)] bg-transparent text-[var(--risk-text,#b42318)] [--focus-ring:var(--risk-text,#b42318)] hover:bg-[var(--risk-surface,#fdf4f2)]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-xs [@media(pointer:coarse)]:min-h-11",
  md: "min-h-11 px-4 text-sm",
};

export function buttonClassName({
  variant = "primary",
  size = "md",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} = {}) {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]}`;
}

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
      className={`${buttonClassName({ variant, size })} ${className}`}
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
