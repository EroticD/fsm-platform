"use client";

import { useRef, useState, useTransition } from "react";

export default function AutoSaveTextArea({
  name,
  defaultValue,
  placeholder,
  action
}: {
  name: string;
  defaultValue: string;
  placeholder?: string;
  action: (formData: FormData) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "saved">("idle");
  const [currentValue, setCurrentValue] = useState(defaultValue);

  const handleBlur = () => {
    // Ikke lagre hvis ingenting er endret
    if (formRef.current && formRef.current[name].value !== currentValue) {
      const newValue = formRef.current[name].value;
      
      startTransition(() => {
        action(new FormData(formRef.current!));
        setCurrentValue(newValue);
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2500); // Skjuler "Lagret"-beskjeden etter 2.5 sek
      });
    }
  };

  return (
    <form ref={formRef} action={action} className="relative">
      <textarea
        name={name}
        defaultValue={defaultValue}
        onBlur={handleBlur}
        rows={4}
        placeholder={placeholder}
        className="w-full border border-gray-200 p-3 rounded-xl text-sm text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
        aria-label={name}
      />
      
      {/* Visuell feedback for autolagring */}
      {isPending && (
        <span className="absolute bottom-4 right-4 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100 shadow-sm">
          Lagrer...
        </span>
      )}
      {!isPending && status === "saved" && (
        <span className="absolute bottom-4 right-4 text-xs font-bold text-green-700 bg-green-50 px-2 py-1 rounded border border-green-200 shadow-sm">
          Lagret! ✅
        </span>
      )}
    </form>
  );
}
