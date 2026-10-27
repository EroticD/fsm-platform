-- Utvid søket med felt som tidligere bare ble vist, ikke indeksert.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_serialNumber_trgm" ON "Product" USING gin ("serialNumber" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_location_trgm" ON "Product" USING gin ("location" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Contact_name_trgm" ON "Contact" USING gin ("name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Contact_email_trgm" ON "Contact" USING gin ("email" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Contact_phone_trgm" ON "Contact" USING gin ("phone" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Template_title_trgm" ON "Template" USING gin ("title" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "DocumentFolder_name_trgm" ON "DocumentFolder" USING gin ("name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_name_trgm" ON "User" USING gin ("name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "User_email_trgm" ON "User" USING gin ("email" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_reportNumber_trgm" ON "Report" USING gin ("reportNumber" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_name_trgm" ON "Report" USING gin ("name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Report_templateTitle_trgm" ON "Report" USING gin ("templateTitle" gin_trgm_ops);

-- Fulltekst for rapporter og sjekkpunkter. Expression-indexen gjør at vi kan
-- søke i rapporttekst uten å legge en tung trigger på hver rapport.
CREATE INDEX IF NOT EXISTS "Report_search_fts_idx" ON "Report" USING gin (
  to_tsvector(
    'norwegian',
    coalesce("name", '') || ' ' ||
    coalesce("templateTitle", '') || ' ' ||
    coalesce("reportNumber", '') || ' ' ||
    coalesce("comments", '')
  )
);
CREATE INDEX IF NOT EXISTS "ReportUnit_answers_fts_idx" ON "ReportUnit" USING gin (
  to_tsvector('norwegian', coalesce("answersJson", ''))
);

-- Arbeidsbeskrivelse er ofte der montøren beskriver jobben.
CREATE INDEX IF NOT EXISTS "WorkOrder_description_fts_idx" ON "WorkOrder" USING gin (
  to_tsvector('norwegian', coalesce("description", ''))
);
