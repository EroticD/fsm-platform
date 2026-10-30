/**
 * Felles stilbiter for kundeflatene i det hybride uttrykket: papir, blekk og
 * signal-lime. Alt leser shellens tokenene med fallback, slik at kundekortet
 * følger paletten selv om det rendres før tokenene er lastet.
 */
export const CUSTOMER_CARD = "office-card";
export const CUSTOMER_INSET =
  "rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--paper,#f2efe6)]";
export const CUSTOMER_SURFACE =
  "rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)]";
export const CUSTOMER_EYEBROW =
  "text-xs font-bold uppercase leading-4 tracking-[0.12em] text-[var(--muted,#62685f)]";
export const CUSTOMER_MUTED = "text-[var(--muted,#62685f)]";
export const CUSTOMER_INK = "text-[var(--ink,#101310)]";
export const CUSTOMER_LABEL =
  "mb-1 block text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted,#62685f)]";
export const CUSTOMER_CONTROL =
  "w-full rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] px-3 py-2 text-base font-medium text-[var(--ink,#101310)] outline-none transition placeholder:text-[#6b6559] hover:border-[#bcb3a0] focus:border-[var(--ink,#101310)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)] [--focus-ring:var(--ink,#101310)]";

export const CUSTOMER_SIGNAL_BUTTON =
  "signal-button whitespace-nowrap border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-xs text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] transition hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--ink,#101310)]";

export const CUSTOMER_INK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[var(--ink,#101310)] bg-transparent px-3 py-2 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--ink,#101310)] hover:text-[var(--paper,#f2efe6)] [--focus-ring:var(--ink,#101310)]";

export const CUSTOMER_RISK_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[#e7b5ae] bg-[#fdf4f2] px-3 py-2 text-xs font-bold text-[var(--risk-text,#b42318)] transition hover:border-[var(--risk-text,#b42318)] hover:bg-[#fbe9e7] [--focus-ring:var(--risk-text,#b42318)]";

export const CUSTOMER_LINK =
  "font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 transition hover:decoration-[var(--ink,#101310)]";

/**
 * Rolig overgang for delte komponenter som ennå har eldre grå/blå klasser.
 * Variantene under arver ned i barn, slik at kundeflatene holder papir/blekk
 * også der komponenten eies av en annen flate.
 */
export const LEGACY_SURFACE =
  "[--focus-ring:var(--ink,#101310)] [&_.bg-white]:bg-[var(--surface,#fffdf8)] [&_.bg-gray-50]:bg-[var(--paper,#f2efe6)] [&_.bg-gray-100]:bg-[var(--paper,#f2efe6)] [&_.bg-gray-200]:bg-[var(--line,#dedcd1)] [&_.border-gray-100]:border-[var(--line,#dedcd1)] [&_.border-gray-200]:border-[var(--line,#dedcd1)] [&_.border-gray-300]:border-[var(--line,#dedcd1)] [&_.divide-gray-100]:divide-[var(--line,#dedcd1)] [&_.divide-gray-200]:divide-[var(--line,#dedcd1)] [&_.text-gray-900]:text-[var(--ink,#101310)] [&_.text-gray-800]:text-[#2a2f28] [&_.text-gray-700]:text-[#3d4237] [&_.text-gray-600]:text-[var(--muted,#62685f)] [&_.text-gray-500]:text-[var(--muted,#62685f)] [&_.text-gray-400]:text-[#8a8f80] [&_.text-blue-600]:text-[var(--ink,#101310)] [&_.text-blue-700]:text-[var(--ink,#101310)] [&_.text-blue-800]:text-[var(--ink,#101310)] [&_.bg-blue-50]:bg-[var(--paper,#f2efe6)] [&_.bg-blue-100]:bg-[var(--paper,#f2efe6)] [&_.bg-blue-600]:bg-[var(--ink,#101310)] [&_.bg-blue-700]:bg-[var(--ink,#101310)] [&_.bg-blue-800]:bg-[var(--ink,#101310)] [&_.border-blue-200]:border-[var(--line,#dedcd1)] [&_.border-blue-300]:border-[var(--line,#dedcd1)]";
