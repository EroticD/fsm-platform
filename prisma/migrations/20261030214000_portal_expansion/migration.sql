-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "siteId" TEXT;

-- CreateTable
CREATE TABLE "PortalDelegation" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "canBook" BOOLEAN NOT NULL DEFAULT false,
    "canViewDocuments" BOOLEAN NOT NULL DEFAULT false,
    "canViewContracts" BOOLEAN NOT NULL DEFAULT false,
    "canViewEquipment" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalDelegation_contactId_key" ON "PortalDelegation"("contactId");

-- CreateIndex
CREATE INDEX "PortalDelegation_contactId_isActive_idx" ON "PortalDelegation"("contactId", "isActive");

-- CreateIndex
CREATE INDEX "Product_siteId_idx" ON "Product"("siteId");

-- CreateIndex
CREATE INDEX "WorkOrder_siteId_idx" ON "WorkOrder"("siteId");

-- AddForeignKey
ALTER TABLE "PortalDelegation" ADD CONSTRAINT "PortalDelegation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CustomerSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CustomerSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: én primært sted fra kundens adresse når kunden ikke har steder.
-- Eksisterende steder røres ikke, og en kunde uten adresse får ingen rad.
INSERT INTO "CustomerSite" (
    "id", "customerId", "name", "address", "postalCode", "city",
    "isPrimary", "createdAt", "updatedAt"
)
SELECT
    'csite_' || md5(random()::text || clock_timestamp()::text || c.id),
    c.id,
    'Hovedadresse',
    c.address,
    c."postalCode",
    c.city,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Customer" c
WHERE c."deletedAt" IS NULL
  AND c.address IS NOT NULL
  AND btrim(c.address) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM "CustomerSite" s WHERE s."customerId" = c.id
  );

-- Kunder som allerede har steder, men mangler et primært, får det eldste
-- stedet markert som primært. Dette er trygt fordi det bare er en visnings-
-- og standardvalgsmarkering; adressene endres ikke.
UPDATE "CustomerSite" s
SET "isPrimary" = true
WHERE s."isPrimary" = false
  AND NOT EXISTS (
      SELECT 1 FROM "CustomerSite" p
      WHERE p."customerId" = s."customerId" AND p."isPrimary" = true
  )
  AND s.id = (
      SELECT first_site.id
      FROM "CustomerSite" first_site
      WHERE first_site."customerId" = s."customerId"
      ORDER BY first_site."createdAt" ASC, first_site.id ASC
      LIMIT 1
  );

-- Koble eksisterende oppdrag til kundens primære sted. Adressefeltene på
-- oppdraget beholder sine egne verdier, slik at historikk og geokoding er
-- uendret; `siteId` er bare en valgfri, sterke referanse.
UPDATE "WorkOrder" w
SET "siteId" = (
    SELECT s.id FROM "CustomerSite" s
    WHERE s."customerId" = w."customerId" AND s."isPrimary" = true
    ORDER BY s."createdAt" ASC, s.id ASC
    LIMIT 1
)
WHERE w."siteId" IS NULL
  AND w."customerId" IS NOT NULL
  AND EXISTS (
      SELECT 1 FROM "CustomerSite" s
      WHERE s."customerId" = w."customerId" AND s."isPrimary" = true
  );

-- Utstyr uten eget sted arver kundens primære sted på samme måte.
UPDATE "Product" p
SET "siteId" = (
    SELECT s.id FROM "CustomerSite" s
    WHERE s."customerId" = p."customerId" AND s."isPrimary" = true
    ORDER BY s."createdAt" ASC, s.id ASC
    LIMIT 1
)
WHERE p."siteId" IS NULL
  AND EXISTS (
      SELECT 1 FROM "CustomerSite" s
      WHERE s."customerId" = p."customerId" AND s."isPrimary" = true
  );

-- Eldre bestillinger uten sted får kundens primære sted som standard.
UPDATE "BookingRequest" b
SET "siteId" = (
    SELECT s.id FROM "CustomerSite" s
    WHERE s."customerId" = b."customerId" AND s."isPrimary" = true
    ORDER BY s."createdAt" ASC, s.id ASC
    LIMIT 1
)
WHERE b."siteId" IS NULL
  AND EXISTS (
      SELECT 1 FROM "CustomerSite" s
      WHERE s."customerId" = b."customerId" AND s."isPrimary" = true
  );
