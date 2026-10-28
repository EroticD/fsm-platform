import { redirect } from "next/navigation";

/**
 * Utstyr har ingen egen hovedside. Enhetene eies av kundene og vises på
 * kundekortet under «Utstyr». Den gamle /enheter-adressen beholdes som en
 * kompatibilitetsomdirigering. Meldingen på kundelisten forklarer hvor
 * enhetene ligger, i stedet for at brukeren havner på en side uten kontekst.
 */
export default function LegacyUnitsPage() {
  redirect("/kunder?varsel=enheter");
}
