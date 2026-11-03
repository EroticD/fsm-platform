/** PWA-/installasjonshjelpere som kan testes uten nettleser. */

export function isStandaloneDisplayMode(input: {
  displayModeStandalone?: boolean | null;
  navigatorStandalone?: boolean | null;
}): boolean {
  // iOS Safari bruker navigator.standalone; alle andre display-mode.
  return Boolean(input.displayModeStandalone || input.navigatorStandalone);
}
