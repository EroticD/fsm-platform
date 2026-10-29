"use client";

import type { ComponentPropsWithoutRef } from "react";
import { useFieldControl } from "./Field";
import { controlClassName } from "./controlStyles";

/** Flerlinjefelt som arver label, hjelpetekst og feilstatus fra Field. */
export default function Textarea({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"textarea">) {
  const field = useFieldControl();
  const describedBy =
    [props["aria-describedby"], field?.describedBy]
      .filter(Boolean)
      .join(" ") || undefined;
  const invalid =
    props["aria-invalid"] ?? (field?.invalid ? true : undefined);

  return (
    <textarea
      {...props}
      id={props.id ?? field?.id}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      className={controlClassName(className, "min-h-24 py-2.5")}
    />
  );
}
