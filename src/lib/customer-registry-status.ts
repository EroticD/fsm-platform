/**
 * Registerstatus for en kunde, slik registervakten lagrer den på `Customer`.
 *
 * Verdiene er stabile data (ikke oversatte strenger). Visning skal gå via
 * `messages/`, slik at samme status kan leses på flere språk.
 */
export type RegistryStatus =
  | "ACTIVE"
  | "BANKRUPT"
  | "UNDER_LIQUIDATION"
  | "NOT_FOUND"
  | "UNKNOWN";

/**
 * Oversetter et Enhetsregister-oppslag til vår status.
 *
 * Konkurs går foran avvikling: en enhet som er både konkurs og under avvikling
 * er først og fremst konkurs, og det er den alvorligste tilstanden for kunden.
 */
export function registryStatusFrom(company: {
  bankrupt: boolean;
  underLiquidation: boolean;
}): RegistryStatus {
  if (company.bankrupt) return "BANKRUPT";
  if (company.underLiquidation) return "UNDER_LIQUIDATION";
  return "ACTIVE";
}

/**
 * Statusene som krever oppfølging: kunden kan ikke faktureres eller inngå nye
 * avtaler uten at noen ser på saken. «NOT_FOUND» og «UNKNOWN» er ikke risiko i
 * seg selv – de kan skyldes feil i registeret eller manglende oppslag.
 */
export function registryStatusIsRisk(
  status: string | null | undefined,
): boolean {
  return status === "BANKRUPT" || status === "UNDER_LIQUIDATION";
}
