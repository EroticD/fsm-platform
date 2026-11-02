-- Menneskelig, unik referanse på oppdrag.
--
-- Nye oppdrag får referansen i tjenestelaget. Denne migreringen backfyller
-- eksisterende rader:
--   1. Oppdrag fra kundeportalen beholder bestillingens B-YYMMDD-XXXXXX.
--   2. Alle andre får O-YYMMDD-XXXXXXXX fra opprettelsesdatoen i Europe/Oslo
--      og en deterministisk md5 av oppdrags-id-en.
--
-- En kollisjon i den genererte delen løses ved å prøve md5(id + ':' + forsøk)
-- til referansen er ledig. Da kan den unike indeksen alltid opprettes, uten
-- tilfeldige verdier som er vanskelige å gjenskape.

ALTER TABLE "WorkOrder" ADD COLUMN "reference" TEXT;

-- Kundebestillinger først. Bestillingenes referanser er allerede unike, og
-- skal bevares uendret på oppdraget.
UPDATE "WorkOrder" AS work_order
SET "reference" = booking."reference"
FROM "BookingRequest" AS booking
WHERE booking."workOrderId" = work_order."id"
  AND work_order."reference" IS NULL;

-- Deretter ordinære oppdrag. Datoen regnes fra UTC-lagret createdAt til Oslo.
DO $$
DECLARE
  work_order RECORD;
  candidate TEXT;
  attempt INT;
BEGIN
  FOR work_order IN
    SELECT
      w."id",
      to_char(
        timezone('Europe/Oslo', w."createdAt" AT TIME ZONE 'UTC'),
        'YYMMDD'
      ) AS "datePart"
    FROM "WorkOrder" AS w
    WHERE w."reference" IS NULL
    ORDER BY w."id"
  LOOP
    candidate :=
      'O-' || work_order."datePart" || '-' ||
      upper(substr(md5(work_order."id"), 1, 8));
    attempt := 0;

    WHILE EXISTS (
      SELECT 1 FROM "WorkOrder" WHERE "reference" = candidate
    ) LOOP
      attempt := attempt + 1;
      candidate :=
        'O-' || work_order."datePart" || '-' ||
        upper(substr(md5(work_order."id" || ':' || attempt::text), 1, 8));
    END LOOP;

    UPDATE "WorkOrder"
    SET "reference" = candidate
    WHERE "id" = work_order."id";
  END LOOP;
END
$$;

ALTER TABLE "WorkOrder" ALTER COLUMN "reference" SET NOT NULL;
CREATE UNIQUE INDEX "WorkOrder_reference_key" ON "WorkOrder"("reference");
