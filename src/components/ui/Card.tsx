import type { HTMLAttributes } from "react";

export type CardElement = "div" | "section" | "article";

/**
 * Grunnflate for kort. Bruker tokens fra globals.css slik at radius, kant,
 * bakgrunn og skygge kan endres ett sted.
 */
export default function Card({
  as: Tag = "div",
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { as?: CardElement }) {
  return (
    <Tag
      className={`rounded-card border border-border-card bg-surface shadow-card ${className}`}
      {...props}
    />
  );
}
