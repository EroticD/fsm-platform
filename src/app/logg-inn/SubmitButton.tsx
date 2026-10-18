"use client";

import { useFormStatus } from "react-dom";

export default function SubmitButton({
  idleLabel,
  pendingLabel,
}: {
  idleLabel: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full text-white py-2.5 rounded-xl font-bold hover:opacity-90 transition shadow-sm disabled:opacity-60"
      style={{ backgroundColor: "var(--primary-color)" }}
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
