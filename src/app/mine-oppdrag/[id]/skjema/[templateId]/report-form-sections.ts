/**
 * Hvilke resultatseksjoner skjemaet skal vise.
 *
 * En mal uten enheter har verken enhetsresultat eller enhetskommentar. Den
 * anonyme raden som lagrer svarene skal derfor ikke få «Godkjent / Avvik»,
 * «Resultat for denne enheten» eller «Kommentar for denne enheten». Samlet
 * resultat og oppfølgingsvarselet faller også bort, siden de bygger på
 * enhetsstatus.
 */
export function reportFormSections(requiresUnits: boolean): {
  showOverallResult: boolean;
  showUnitResult: boolean;
  showUnitComment: boolean;
  showFollowUpWarning: boolean;
} {
  return {
    showOverallResult: requiresUnits,
    showUnitResult: requiresUnits,
    showUnitComment: requiresUnits,
    showFollowUpWarning: requiresUnits,
  };
}
