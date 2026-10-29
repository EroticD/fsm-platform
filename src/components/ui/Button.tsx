import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-sm hover:opacity-90 active:opacity-100",
  secondary:
    "border border-gray-300 bg-surface text-gray-900 shadow-sm hover:bg-gray-50",
  ghost: "text-gray-700 hover:bg-gray-100",
  danger: "bg-danger text-white shadow-sm hover:bg-red-800",
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
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
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
