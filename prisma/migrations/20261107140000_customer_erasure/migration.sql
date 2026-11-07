-- GDPR-sletting: anonymiseringstilstand på kunde og rapport.
--
-- `Customer.anonymisedAt` gjør tjenesten idempotent og synlig uten å endre
-- tjenestehistorikken. `Report.customerDataRedactedAt` markerer at kundens
-- direkte identifikatorer er fjernet fra rapportens strukturerte felt, mens
-- en allerede signert PDF bevares uendret som tjenestebevis.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "anonymisedAt" TIMESTAMP(3),
ADD COLUMN     "anonymisedBy" TEXT;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "customerDataRedactedAt" TIMESTAMP(3);
