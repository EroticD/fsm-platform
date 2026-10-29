"use client";

import type { ComponentPropsWithoutRef } from "react";
import { useFieldControl } from "./Field";
import { controlClassName } from "./controlStyles";

/** Nedtrekksfelt som arver label, hjelpetekst og feilstatus fra Field. */
export default function Select({
  className = "",
  ...props
}: ComponentPropsWithoutRef<"select">) {
  const field = useFieldControl();
  const describedBy =
    [props["aria-describedby"], field?.describedBy]
      .filter(Boolean)
      .join(" ") || undefined;
  const invalid =
    props["aria-invalid"] ?? (field?.invalid ? true : undefined);

  return (
    <select
      {...props}
      id={props.id ?? field?.id}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      className={controlClassName(className, "min-h-11 pr-8")}
    />
  );
}
