/**
 * Felles flater i det hybride uttrykket: papir, blekk og signal-lime.
 *
 * Shellen eier tokenene i globals.css. Vi leser dem gjennom `var()` med en
 * fallback, slik at komponentene ser riktige ut også før tokenene er på plass
 * – og følger shellen automatisk når den justerer paletten.
 */
export const brandCard =
  "office-card rounded-card border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] shadow-[0_1px_2px_rgba(20,17,11,0.05)]";

export const brandCanvas = "bg-[var(--canvas,#f4f5f2)]";
export const brandPaper = "bg-[var(--paper,#f2efe6)]";
export const brandSurface = "bg-[var(--surface,#fffdf8)]";
export const brandInk = "text-[var(--ink,#101310)]";
export const brandMuted = "text-[var(--muted,#62685f)]";
export const brandLine = "border-[var(--line,#dedcd1)]";
export const brandSignal = "bg-[var(--signal,#d8ff3e)]";
/** Risiko som tekstfarge. Shellens --risk er for lys som bakgrunn; denne
 *  mørkere varianten gir 4,5:1 også på papir og rødlige feilflater. */
export const brandRisk = "text-[#a92a12]";

export const brandSignalButton =
  "signal-button bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]";

export const brandInkButton =
  "border border-[var(--ink,#101310)] bg-transparent text-[var(--ink,#101310)]";

/** Liten etikett over tall og seksjoner. */
export const brandEyebrow =
  "text-xs font-bold uppercase leading-4 tracking-[0.12em] text-[var(--muted,#62685f)]";

/** Rolig, papirfarget indre flate med samme linje som kortene. */
export const brandInset =
  "rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]";
