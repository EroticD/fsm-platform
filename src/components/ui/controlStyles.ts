/**
 * Felles utseende for Input/Select/Textarea. 44 px høyde og 16 px tekst
 * matcher berøringsmålet og hindrer iOS-zoom på mobil. Kontrollene ligger på
 * papirflaten med blekk-kant og får shellens fokusring fra globals.css.
 */
export const controlBase =
  "w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-base text-[var(--ink,#101310)] shadow-[inset_0_1px_0_rgba(20,17,11,0.03)] transition [--focus-ring:var(--ink,#101310)] placeholder:text-[#6b6559] hover:border-[#bcb3a0] focus:border-[var(--ink,#101310)] disabled:cursor-not-allowed disabled:bg-[var(--paper,#f2efe6)] disabled:text-[#7a7468] aria-[invalid=true]:border-[var(--risk,#f04427)] aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-[var(--risk,#f04427)]";

export function controlClassName(className = "", extra = "") {
  return [controlBase, extra, className].filter(Boolean).join(" ");
}
