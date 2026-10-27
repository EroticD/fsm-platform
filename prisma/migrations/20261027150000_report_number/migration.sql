-- Automatisk rapportnummer for HMS-rapporter.
ALTER TABLE "Report" ADD COLUMN "reportNumber" TEXT;
ALTER TABLE "ReportRevision" ADD COLUMN "reportNumber" TEXT;

-- Backfill eksisterende HMS-rapporter med et unikt nummer på formatet abc1234.
-- Generatoren prøver på nytt ved kollisjon, slik at den unike indeksen under
-- alltid kan opprettes.
DO $$
DECLARE
  report_row RECORD;
  candidate TEXT;
  attempt INT;
BEGIN
  FOR report_row IN
    SELECT "id"
    FROM "Report"
    WHERE "templateCategory" = 'HMS' AND "reportNumber" IS NULL
  LOOP
    candidate := NULL;
    FOR attempt IN 1..100 LOOP
      candidate :=
        (
          SELECT string_agg(
            substr('abcdefghijklmnopqrstuvwxyz', floor(random() * 26)::int + 1, 1),
            ''
          )
          FROM generate_series(1, 3)
        ) ||
        lpad((floor(random() * 10000)::int)::text, 4, '0');

      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "Report" WHERE "reportNumber" = candidate
      );
    END LOOP;

    IF candidate IS NULL THEN
      RAISE EXCEPTION 'Kunne ikke generere unikt rapportnummer';
    END IF;

    UPDATE "Report" SET "reportNumber" = candidate WHERE "id" = report_row."id";
  END LOOP;
END $$;

CREATE UNIQUE INDEX "Report_reportNumber_key" ON "Report"("reportNumber");

UPDATE "ReportRevision" AS revision
SET "reportNumber" = report."reportNumber"
FROM "Report" AS report
WHERE revision."reportId" = report."id";
