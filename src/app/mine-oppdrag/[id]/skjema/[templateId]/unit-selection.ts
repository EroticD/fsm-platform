/**
 * Ren logikk for å koble en rapportrad til en registrert kundenhet.
 *
 * En registrert enhet skal bare kunne brukes én gang i samme rapport. Reglene
 * ligger her (ikke inne i skjemaet) slik at både klienten, kladdegjenoppretting
 * og testene bruker nøyaktig samme vurdering.
 */

export type UnitWithProduct = {
  key: string;
  productId: string;
  label: string;
  serialNumber: string;
  location: string;
};

export type RegisteredProduct = {
  id: string;
  model: string;
  serialNumber: string | null;
  location: string | null;
};

/** Produkt-id-ene som er valgt av andre rader enn `key`. */
export function productIdsUsedByOtherUnits(
  units: Array<{ key: string; productId: string }>,
  key: string,
): Set<string> {
  return new Set(
    units
      .filter((unit) => unit.key !== key)
      .map((unit) => unit.productId.trim())
      .filter(Boolean),
  );
}

/**
 * Enhetene som kan velges i én rad. Enheten som alt er valgt i raden holdes
 * synlig, slik at select-en viser riktig verdi. Enheter som er valgt i en annen
 * rad tilbys ikke.
 */
export function selectableCustomerUnits<T extends { id: string }>(
  customerUnits: T[],
  units: Array<{ key: string; productId: string }>,
  key: string,
): T[] {
  const usedElsewhere = productIdsUsedByOtherUnits(units, key);
  const ownProductId =
    units.find((unit) => unit.key === key)?.productId.trim() ?? "";

  return customerUnits.filter(
    (product) =>
      product.id === ownProductId || !usedElsewhere.has(product.id),
  );
}

/**
 * Kobler raden til en registrert enhet. Returnerer `duplicate` når en annen rad
 * alt bruker enheten; da skal raden stå urørt. Ukjent/blank enhet tømmer bare
 * produktkoblingen, slik at metadata montøren har skrevet blir bevart.
 */
export function linkUnitToProduct<T extends UnitWithProduct>(
  units: T[],
  key: string,
  product: RegisteredProduct | null,
): { units: T[]; duplicate: boolean; changed: boolean } {
  const unit = units.find((candidate) => candidate.key === key);
  if (!unit) return { units, duplicate: false, changed: false };

  if (!product) {
    if (!unit.productId) return { units, duplicate: false, changed: false };
    return {
      units: units.map((candidate) =>
        candidate.key === key ? { ...candidate, productId: "" } : candidate,
      ),
      duplicate: false,
      changed: true,
    };
  }

  if (
    units.some(
      (candidate) =>
        candidate.key !== key && candidate.productId.trim() === product.id,
    )
  ) {
    return { units, duplicate: true, changed: false };
  }

  const next: T = {
    ...unit,
    productId: product.id,
    label: product.model,
    serialNumber: product.serialNumber ?? "",
    location: product.location ?? "",
  };
  const changed =
    unit.productId !== next.productId ||
    unit.label !== next.label ||
    unit.serialNumber !== next.serialNumber ||
    unit.location !== next.location;

  return {
    units: changed
      ? units.map((candidate) => (candidate.key === key ? next : candidate))
      : units,
    duplicate: false,
    changed,
  };
}

/**
 * Fjerner produktkoblingen fra alle rader etter den første som bruker samme
 * registrerte enhet. Brukes når en kladd eller rapport skrevet før regelen ble
 * innført inneholder duplikater. Første rad vinner, slik at resultatet er
 * deterministisk uansett rekkefølgen dataene kommer i.
 */
export function dedupeUnitProductIds<T extends { productId: string }>(
  units: T[],
): { units: T[]; cleared: number } {
  const seen = new Set<string>();
  let cleared = 0;

  const next = units.map((unit) => {
    const productId = unit.productId.trim();
    if (!productId) return unit;
    if (!seen.has(productId)) {
      seen.add(productId);
      return unit;
    }
    cleared += 1;
    return { ...unit, productId: "" };
  });

  return { units: cleared > 0 ? next : units, cleared };
}

/** Teller hvor mange registrerte enheter som er valgt mer enn én gang. */
export function countDuplicateUnitProductIds(
  units: Array<{ productId: string }>,
): number {
  return dedupeUnitProductIds(units).cleared;
}
