-- Slutt å lagre OCR-teksten to ganger.
--
-- `Document.contentText` og `Document.pageTexts` inneholder samme tekst:
-- `contentText` er sidene fra `pageTexts` slått sammen. Bare `pageTexts` er
-- fasit (den brukes til sidevisning og til utdrag), og OCR-jobben skriver den
-- alene fra nå av.
--
-- Teksten i `contentText` kan alltid gjenoppbygges fra `pageTexts`, og eksporten
-- gjør nettopp det (`documentText()` i src/lib/document-text.ts), slik at eldre
-- importformat fortsatt får feltet. Kolonnen droppes ikke: eldre importer og
-- manuell feilsøking leser den, og et dropp ville vært et større inngrep enn
-- nødvendig. Poenget er å slutte å lagre samme tekst to ganger.
--
-- `searchTsv` vedlikeholdes av en trigger som tidligere bygget teksten fra
-- `contentText`. Uten denne oppdateringen ville fulltekstsøket mistet
-- dokumentinnholdet i det øyeblikket OCR-jobben slutter å skrive `contentText`.
-- Triggeren bygger derfor teksten fra `pageTexts`, med `contentText` som
-- fallback for rader som ennå ikke har sidetekst.

CREATE OR REPLACE FUNCTION "document_search_tsv_update"()
RETURNS trigger AS $$
DECLARE
  page_text text;
BEGIN
  BEGIN
    IF NEW."pageTexts" IS NOT NULL AND btrim(NEW."pageTexts") <> '' THEN
      SELECT string_agg(coalesce(element->>'text', ''), E'\n\n' ORDER BY ord)
        INTO page_text
        FROM jsonb_array_elements(NEW."pageTexts"::jsonb) WITH ORDINALITY AS t(element, ord);
    END IF;
  EXCEPTION WHEN others THEN
    -- Ugyldig JSON i pageTexts skal aldri velte en skriving. Da faller vi
    -- tilbake til contentText (og til slutt til tom streng).
    page_text := NULL;
  END;

  NEW."searchTsv" := to_tsvector(
    'norwegian',
    coalesce(NEW."title", '') || ' ' ||
    coalesce(NEW."description", '') || ' ' ||
    coalesce(page_text, NEW."contentText", '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Document_searchTsv_update" ON "Document";
CREATE TRIGGER "Document_searchTsv_update"
  BEFORE INSERT OR UPDATE OF "title", "description", "contentText", "pageTexts"
  ON "Document"
  FOR EACH ROW
  EXECUTE FUNCTION "document_search_tsv_update"();

-- Backfill searchTsv for dokumenter som allerede har sidetekst, slik at
-- innholdet blir søkbart også etter at contentText er tømt.
UPDATE "Document" d
SET "searchTsv" = to_tsvector(
  'norwegian',
  coalesce(d."title", '') || ' ' ||
  coalesce(d."description", '') || ' ' ||
  coalesce(
    (
      SELECT string_agg(coalesce(element->>'text', ''), E'\n\n' ORDER BY ord)
      FROM jsonb_array_elements(d."pageTexts"::jsonb) WITH ORDINALITY AS t(element, ord)
    ),
    d."contentText",
    ''
  )
)
WHERE d."pageTexts" IS NOT NULL AND btrim(d."pageTexts") <> '';

-- Selve duplikatet: teksten finnes fortsatt i pageTexts og kan gjenoppbygges.
UPDATE "Document"
SET "contentText" = NULL
WHERE "pageTexts" IS NOT NULL
  AND "contentText" IS NOT NULL;
