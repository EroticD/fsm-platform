-- Indekserbart normalisert søk.
--
-- Søket normaliserte tidligere kolonnen i selve spørringen
-- (lower → unaccent → ikke-alfanumerisk til mellomrom → kollaps → btrim) og
-- brukte `strpos(...) > 0`. Da kunne ingen indeks brukes: GIN-trigram-indeksene
-- lå på rå kolonne, og `strpos` er dessuten ikke indekserbar i det hele tatt.
-- Resultatet var sekvensskanning av hver tabell for hvert søk.
--
-- Her løftes normaliseringen ut i en IMMUTABLE funksjon, slik at den kan
-- indekseres som et uttrykk. Applikasjonen bruker samme funksjon i WHERE og
-- matcher med `LIKE '%term%'`, som gin_trgm_ops kan bruke.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Nøyaktig samme normalisering som `normalizeSearchText` i src/lib/fuzzy.ts og
-- som det tidligere inline SQL-uttrykket:
--
--   btrim(regexp_replace(lower(unaccent(coalesce(x, ''))), '[^a-z0-9]+', ' ', 'g'))
--
-- Rekkefølgen er viktig: `lower` før `unaccent` (slik at «Æ» blir «ae» og ikke
-- «Ae»), `unaccent` før tegnfiltreringen (slik at «é» blir «e», ikke et
-- mellomrom), og `+` i tegnklassen kollapser sammenhengende skilletegn til ett
-- mellomrom før `btrim` trimmer endene. NULL gir tom streng, som før.
--
-- AVVEINING – hvorfor IMMUTABLE:
-- `unaccent(text)` er merket STABLE, fordi ordboken kan endres med
-- `CREATE TEXT SEARCH DICTIONARY`. En uttrykksindeks krever IMMUTABLE. Vi
-- erklærer derfor wrapperen IMMUTABLE og regner unaccent-ordboken som en del av
-- skjemaet: den endres bare gjennom en migrering. Endres `unaccent.rules`
-- (PostgreSQL-oppgradering eller ny ordbok), MÅ indeksene bygges på nytt:
--
--   REINDEX INDEX "Customer_name_search_trgm"; -- og de øvrige
--
-- Uten reindex kan LIKE mot indeksen gi falske negativer, fordi lagrede
-- trigrammer er laget med den gamle ordboken. Funksjonen brukes bare til søk;
-- den er ikke en del av noen lagret forretningsverdi.
CREATE OR REPLACE FUNCTION fsm_search_norm(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(
    regexp_replace(
      lower(unaccent(coalesce(input, ''))),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  )
$$;

-- Normaliserte uttrykksindekser: én per kolonne søket faktisk leser
-- (NORMALIZED_SEARCH_TABLES i src/lib/search-sql.ts, pluss Document.fileName
-- fra searchDocuments). LIKE '%term%' bruker disse via gin_trgm_ops.

-- Customer: hele kundekortet, fordi orgnummer, kundenummer, telefon, e-post,
-- adresse, postnummer og notater også skal gi kundetreff.
CREATE INDEX IF NOT EXISTS "Customer_name_search_trgm"
  ON "Customer" USING gin (fsm_search_norm("name") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_customerNumber_search_trgm"
  ON "Customer" USING gin (fsm_search_norm("customerNumber") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_orgNumber_search_trgm"
  ON "Customer" USING gin (fsm_search_norm("orgNumber") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_phone_search_trgm"
  ON "Customer" USING gin (fsm_search_norm("phone") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_email_search_trgm"
  ON "Customer" USING gin (fsm_search_norm("email") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_address_search_trgm"
  ON "Customer" USING gin (fsm_search_norm("address") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_postalCode_search_trgm"
  ON "Customer" USING gin (fsm_search_norm("postalCode") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_city_search_trgm"
  ON "Customer" USING gin (fsm_search_norm("city") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_notes_search_trgm"
  ON "Customer" USING gin (fsm_search_norm("notes") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "CustomerSite_name_search_trgm"
  ON "CustomerSite" USING gin (fsm_search_norm("name") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "CustomerSite_address_search_trgm"
  ON "CustomerSite" USING gin (fsm_search_norm("address") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "CustomerSite_postalCode_search_trgm"
  ON "CustomerSite" USING gin (fsm_search_norm("postalCode") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "CustomerSite_city_search_trgm"
  ON "CustomerSite" USING gin (fsm_search_norm("city") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Contact_name_search_trgm"
  ON "Contact" USING gin (fsm_search_norm("name") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_email_search_trgm"
  ON "Contact" USING gin (fsm_search_norm("email") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_phone_search_trgm"
  ON "Contact" USING gin (fsm_search_norm("phone") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Contact_role_search_trgm"
  ON "Contact" USING gin (fsm_search_norm("role") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "User_name_search_trgm"
  ON "User" USING gin (fsm_search_norm("name") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_email_search_trgm"
  ON "User" USING gin (fsm_search_norm("email") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_phone_search_trgm"
  ON "User" USING gin (fsm_search_norm("phone") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_model_search_trgm"
  ON "Product" USING gin (fsm_search_norm("model") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_serialNumber_search_trgm"
  ON "Product" USING gin (fsm_search_norm("serialNumber") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_location_search_trgm"
  ON "Product" USING gin (fsm_search_norm("location") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "WorkOrder_title_search_trgm"
  ON "WorkOrder" USING gin (fsm_search_norm("title") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "WorkOrder_description_search_trgm"
  ON "WorkOrder" USING gin (fsm_search_norm("description") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "WorkOrder_reference_search_trgm"
  ON "WorkOrder" USING gin (fsm_search_norm("reference") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "WorkOrder_orderNumber_search_trgm"
  ON "WorkOrder" USING gin (fsm_search_norm("orderNumber") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Tag_name_search_trgm"
  ON "Tag" USING gin (fsm_search_norm("name") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Report_reportNumber_search_trgm"
  ON "Report" USING gin (fsm_search_norm("reportNumber") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Report_name_search_trgm"
  ON "Report" USING gin (fsm_search_norm("name") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Report_templateTitle_search_trgm"
  ON "Report" USING gin (fsm_search_norm("templateTitle") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Report_comments_search_trgm"
  ON "Report" USING gin (fsm_search_norm("comments") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Comment_content_search_trgm"
  ON "Comment" USING gin (fsm_search_norm("content") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Comment_authorName_search_trgm"
  ON "Comment" USING gin (fsm_search_norm("authorName") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Template_title_search_trgm"
  ON "Template" USING gin (fsm_search_norm("title") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Template_reportName_search_trgm"
  ON "Template" USING gin (fsm_search_norm("reportName") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Template_description_search_trgm"
  ON "Template" USING gin (fsm_search_norm("description") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "DocumentFolder_name_search_trgm"
  ON "DocumentFolder" USING gin (fsm_search_norm("name") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Document_fileName_search_trgm"
  ON "Document" USING gin (fsm_search_norm("fileName") gin_trgm_ops);

-- Kompakte uttrykksindekser. Bare kolonner der separatorer faktisk kan stå i
-- veien: telefon-, org-, kunde-, post- og serienumre samt referanser og
-- filnavn. For fritekst (navn, notater, kommentarer) er kompakt form uten
-- praktisk verdi, og en ekstra GIN-indeks ville bare kostet skriving.
--
-- Uttrykket må være skrevet nøyaktig som i src/lib/search-sql.ts
-- (`replace(fsm_search_norm(...), ' ', '')`). PostgreSQL inliner
-- SQL-funksjoner når spørringen planlegges, men indeksuttrykket lagres
-- uinnlinet; en egen fsm_search_compact()-funksjon ville derfor aldri blitt
-- matchet av indeksen. Derfor står replace(...) eksplisitt begge steder.
CREATE INDEX IF NOT EXISTS "Customer_customerNumber_search_compact_trgm"
  ON "Customer" USING gin (replace(fsm_search_norm("customerNumber"), ' ', '') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_orgNumber_search_compact_trgm"
  ON "Customer" USING gin (replace(fsm_search_norm("orgNumber"), ' ', '') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_phone_search_compact_trgm"
  ON "Customer" USING gin (replace(fsm_search_norm("phone"), ' ', '') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Customer_postalCode_search_compact_trgm"
  ON "Customer" USING gin (replace(fsm_search_norm("postalCode"), ' ', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "CustomerSite_postalCode_search_compact_trgm"
  ON "CustomerSite" USING gin (replace(fsm_search_norm("postalCode"), ' ', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Contact_phone_search_compact_trgm"
  ON "Contact" USING gin (replace(fsm_search_norm("phone"), ' ', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "User_phone_search_compact_trgm"
  ON "User" USING gin (replace(fsm_search_norm("phone"), ' ', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_serialNumber_search_compact_trgm"
  ON "Product" USING gin (replace(fsm_search_norm("serialNumber"), ' ', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "WorkOrder_reference_search_compact_trgm"
  ON "WorkOrder" USING gin (replace(fsm_search_norm("reference"), ' ', '') gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "WorkOrder_orderNumber_search_compact_trgm"
  ON "WorkOrder" USING gin (replace(fsm_search_norm("orderNumber"), ' ', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Report_reportNumber_search_compact_trgm"
  ON "Report" USING gin (replace(fsm_search_norm("reportNumber"), ' ', '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Document_fileName_search_compact_trgm"
  ON "Document" USING gin (replace(fsm_search_norm("fileName"), ' ', '') gin_trgm_ops);
