"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ToastProvider";

/**
 * Viser en toast én gang når en server action har redirectet tilbake med en
 * statuskode. Komponenten rendres bare når statusen finnes i URL-en.
 */
export default function CustomerToast({
  message,
  tone = "success",
}: {
  message: string;
  tone?: "success" | "error" | "info";
}) {
  const { toast } = useToast();
  const shown = useRef(false);

  useEffect(() => {
    if (!message || shown.current) return;
    shown.current = true;
    toast(message, tone);
  }, [message, tone, toast]);

  return null;
}
