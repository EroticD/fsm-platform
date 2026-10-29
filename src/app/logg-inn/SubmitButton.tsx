"use client";

import { useFormStatus } from "react-dom";
import Button from "@/components/ui/Button";

export default function SubmitButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      pending={pending}
      className="w-full"
      suppressHydrationWarning
    >
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}
