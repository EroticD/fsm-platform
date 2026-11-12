-- Registervakt: siste kjente status fra Enhetsregisteret per kunde.
-- Feltet er tekst (ikke enum) fordi «ukjent» og «ikke funnet» også skal kunne
-- lagres uten en migrering hver gang kilden legger til en ny tilstand.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "registryStatus" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "registryCheckedAt" TIMESTAMP(3);

-- Vakten og kundelisten filtrerer på status, f.eks. konkurs og avvikling.
CREATE INDEX IF NOT EXISTS "Customer_registryStatus_idx" ON "Customer"("registryStatus");
