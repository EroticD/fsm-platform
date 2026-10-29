-- SEC-26: Søkeloggen skal ikke kunne knyttes til brukeren som søkte, og
-- eksisterende rader kan inneholde rå søketekst med personopplysninger.
-- Loggen brukes bare til aggregert analyse, så den nullstilles før
-- brukerkolonnen fjernes. Nye rader maskeres av tjenestelaget før insert.

DELETE FROM "SearchLog";

DROP INDEX IF EXISTS "SearchLog_userId_createdAt_idx";
ALTER TABLE "SearchLog" DROP CONSTRAINT IF EXISTS "SearchLog_userId_fkey";
ALTER TABLE "SearchLog" DROP COLUMN IF EXISTS "userId";
