import type { Customer } from "@prisma/client";

type AddressParts = Pick<Customer, "address" | "postalCode" | "city">;

/**
 * Formaterer en kundeadresse til én linje, f.eks. «Storgata 1, 6002 Ålesund».
 *
 * Returnerer en tom streng når kunden mangler adresse, slik at kallstedene kan
 * velge å skjule adresselinjen helt.
 */
export function formatAddress(customer?: Partial<AddressParts> | null): string {
  if (!customer) return "";

  const street = customer.address?.trim() || "";
  const cityLine = [customer.postalCode, customer.city]
    .map((part) => part?.trim() || "")
    .filter(Boolean)
    .join(" ");

  return [street, cityLine].filter(Boolean).join(", ");
}
