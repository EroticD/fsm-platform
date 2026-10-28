import type { Prisma } from "@prisma/client";

/**
 * Feltene på kundekortet som skal gi treff i kundesøket.
 *
 * Listen holdes i takt med `Customer`-allowlisten i `search-sql.ts`, slik at
 * kundelisten, kundevelgeren og montørens kundeoppslag matcher de samme
 * opplysningene. Telefon, org.nr og kundenummer lagres ofte med mellomrom og
 * tegnsetting; den normaliserte SQL-veien kompakterer begge sider før den
 * sammenligner.
 */
export const CUSTOMER_SEARCH_FIELDS = [
  "name",
  "customerNumber",
  "orgNumber",
  "phone",
  "email",
  "address",
  "postalCode",
  "city",
  "notes",
] as const;

export type CustomerSearchField = (typeof CUSTOMER_SEARCH_FIELDS)[number];

/**
 * Direkte Prisma-filter over alle kundekortfeltene.
 *
 * Dette er bevisst et vanlig `contains`-filter uten normalisering. Det brukes
 * bare der vi ikke kan bruke `searchNormalizedIds`, først og fremst
 * administratorens visning av slettede kunder: hjelpefunksjonen filtrerer
 * alltid bort `deletedAt`, mens slettede kunder fortsatt skal kunne søkes opp.
 */
export function customerSearchOr(query: string): Prisma.CustomerWhereInput {
  const search = query.trim();
  if (!search) return {};

  const contains = { contains: search, mode: "insensitive" as const };
  return {
    OR: [
      { name: contains },
      { customerNumber: contains },
      { orgNumber: contains },
      { phone: contains },
      { email: contains },
      { address: contains },
      { postalCode: contains },
      { city: contains },
      { notes: contains },
    ],
  };
}
