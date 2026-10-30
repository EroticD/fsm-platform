import type { ReactNode } from "react";
import { splitHighlight } from "@/lib/highlight";

/**
 * Viser tekst med søketreff uthevet som ekte React-elementer.
 *
 * Ingen HTML fra søket eller databasen tolkes. Komponenten brukes både i
 * gruppelister og i «Beste treff».
 */
export default function HighlightedText({
  text,
  query,
}: {
  text: string;
  query: string;
}): ReactNode {
  return (
    <>
      {splitHighlight(text, query).map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="rounded-sm bg-[var(--signal,#d8ff3e)] px-0.5 text-[var(--ink,#101310)]"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
