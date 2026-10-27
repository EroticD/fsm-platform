import { serializeSearchFilters, type SearchFilters } from "@/lib/search-filters";

/**
 * Skjulte filterfelt for server action-skjemaer, slik at lagring og sletting
 * kan sende brukeren tilbake til nøyaktig samme søk.
 */
export default function FilterHiddenInputs({
  filters,
}: {
  filters: SearchFilters;
}) {
  const params = new URLSearchParams(serializeSearchFilters(filters));

  return (
    <>
      {Array.from(params.entries()).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}
