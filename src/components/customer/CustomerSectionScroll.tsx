"use client";

import { useEffect } from "react";

/**
 * Ruller til riktig seksjon når en gammel faneadresse som ?tab=kontakter
 * eller ?tab=vedlegg løses til den nye Mer-fanen.
 */
export default function CustomerSectionScroll({
  target,
}: {
  target: string | null;
}) {
  useEffect(() => {
    if (!target) return;
    document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [target]);

  return null;
}
