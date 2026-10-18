"use client";

import type { ReactNode } from "react";

/**
 * A thin Client Component wrapper that runs a `confirm()` check before a
 * Server Action is submitted. Event handlers can't be attached to a `<form>`
 * from a Server Component, so the form itself lives here.
 */
export default function ConfirmSubmitForm({
  action,
  confirmMessage,
  className,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  confirmMessage: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(event) => {
        if (!confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
