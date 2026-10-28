import { redirect } from "next/navigation";

/**
 * Utstyr har ingen egen hovedside. Enhetene eies av kundene og vises på
 * kundekortet under «Enheter». Den gamle /enheter-adressen beholdes som en
 * kompatibilitetsomdirigering, slik at bokmerker og gamle lenker ikke blir
 * stående på en foreldreløs side.
 */
export default function LegacyUnitsPage() {
  redirect("/kunder");
}
