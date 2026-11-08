/**
 * Felles flater i det hybride uttrykket: papir, blekk og signal-lime.
 *
 * Shellen eier tokenene i globals.css. Vi leser dem gjennom `var()` med en
 * fallback, slik at komponentene ser riktige ut også før tokenene er på plass
 * – og følger shellen automatisk når den justerer paletten.
 */

/**
 * Kortflaten. `.office-card` eier bakgrunn, kant, radius og den todelte
 * skyggen; her legges bare Tailwind-radiusen på toppen for API-kompatibilitet.
 */
export const brandCard = "office-card rounded-card";

export const brandCanvas = "bg-[var(--canvas,#f4f5f2)]";
export const brandPaper = "bg-[var(--paper,#f2efe6)]";
export const brandSurface = "bg-[var(--surface,#fffdf8)]";
export const brandInk = "text-[var(--ink,#101310)]";
export const brandMuted = "text-[var(--muted,#62685f)]";
export const brandLine = "border-[var(--line,#dedcd1)]";
export const brandSignal = "bg-[var(--signal,#d8ff3e)]";
/** Risiko som tekstfarge. Shellens --risk er for lys som bakgrunn; denne
 *  mørkere varianten gir 4,5:1 også på papir og rødlige feilflater. */
export const brandRisk = "text-[var(--risk-text,#b42318)]";

export const brandSignalButton =
  "signal-button bg-[var(--signal,#d8ff3e)] text-[var(--ink,#101310)]";

export const brandInkButton =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] [--focus-ring:var(--ink,#101310)]";

/** Liten etikett over tall og seksjoner. */
export const brandEyebrow =
  "type-eyebrow text-[var(--muted,#62685f)]";

/**
 * Eneste nested-surface: rolig papirflate med samme linje som kortene.
 * Bruk denne i stedet for å stable et nytt `office-card` inni et kort.
 */
export const brandInset = "rounded-xl border border-line bg-paper";
