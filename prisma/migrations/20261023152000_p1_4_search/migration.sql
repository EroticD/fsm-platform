-- P1-4: PostgreSQL fulltekst og trigram-indekser.
--
-- Erstatter ILIKE '%q%' (sekvensiell skanning) for navn/identifikatorer, og
-- gjør dokumentsøk til en GIN-indeks over en tsvector. contentText blir
-- liggende i databasen, men søket trenger aldri å laste den inn i Node.
--
-- Prisma kan ikke uttrykke GENERATED-kolonner. Vi holder derfor searchTsv
-- oppdatert med en trigger, slik at schema.prisma og databasen er i synk.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE "Document" ADD COLUMN "searchTsv" tsvector;

CREATE OR REPLACE FUNCTION "document_search_tsv_update"()
RETURNS trigger AS $$
BEGIN
  NEW."searchTsv" := to_tsvector(
    'norwegian',
    coalesce(NEW."title", '') || ' ' ||
    coalesce(NEW."description", '') || ' ' ||
    coalesce(NEW."contentText", '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Document_searchTsv_update" ON "Document";
CREATE TRIGGER "Document_searchTsv_update"
  BEFORE INSERT OR UPDATE OF "title", "description", "contentText"
  ON "Document"
  FOR EACH ROW
  EXECUTE FUNCTION "document_search_tsv_update"();

-- Backfill eksisterende dokumenter.
UPDATE "Document"
SET "searchTsv" = to_tsvector(
  'norwegian',
  coalesce("title", '') || ' ' ||
  coalesce("description", '') || ' ' ||
  coalesce("contentText", '')
);

CREATE INDEX "Document_searchTsv" ON "Document" USING gin ("searchTsv");

CREATE INDEX "Customer_name_trgm" ON "Customer" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Customer_city_trgm" ON "Customer" USING gin ("city" gin_trgm_ops);
CREATE INDEX "Product_model_trgm" ON "Product" USING gin ("model" gin_trgm_ops);
CREATE INDEX "WorkOrder_title_trgm" ON "WorkOrder" USING gin ("title" gin_trgm_ops);
