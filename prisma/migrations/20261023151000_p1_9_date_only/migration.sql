-- P1-9: kalenderdatoer lagres som PostgreSQL date, ikke timestamp.
--
-- Eksisterende verdier er UTC-midnatt. Vi gjør casten eksplisitt i UTC, slik
-- at migreringen gir samme dato uansett hvilken tidssone serveren kjører i.
-- Kjør i et vedlikehetsvindu: ALTER TYPE låser tabellene kort.
SET TIME ZONE 'UTC';

ALTER TABLE "Contract"
  ALTER COLUMN "startDate" SET DATA TYPE DATE
    USING ("startDate" AT TIME ZONE 'UTC')::date,
  ALTER COLUMN "nextServiceDate" SET DATA TYPE DATE
    USING ("nextServiceDate" AT TIME ZONE 'UTC')::date;

ALTER TABLE "WorkOrder"
  ALTER COLUMN "scheduledFor" SET DATA TYPE DATE
    USING ("scheduledFor" AT TIME ZONE 'UTC')::date,
  ALTER COLUMN "scheduledTo" SET DATA TYPE DATE
    USING ("scheduledTo" AT TIME ZONE 'UTC')::date;
