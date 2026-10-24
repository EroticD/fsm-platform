/** Intervallene en serviceavtale kan ha, i måneder. */
export const CONTRACT_INTERVAL_MONTHS = [3, 6, 12, 24] as const;

export type ContractIntervalMonths = (typeof CONTRACT_INTERVAL_MONTHS)[number];

/** Sjekker at en vilkårlig verdi er et av de tillatte intervallene. */
export function isContractInterval(value: number): value is ContractIntervalMonths {
  return (CONTRACT_INTERVAL_MONTHS as readonly number[]).includes(value);
}

/** Kort visningsnavn, f.eks. «3 mnd» eller «24 mnd». */
export function contractIntervalLabel(months: number): string {
  return `${months} mnd`;
}
