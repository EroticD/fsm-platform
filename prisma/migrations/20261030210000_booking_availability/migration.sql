-- Phase 5A: ekte tilgjengelighetsbooking.
--
-- Bestillingen kan nå bekreftes direkte mot en ledig time. `BookingHold`
-- reserverer timen mens kunden fyller ut skjemaet, og `CustomerSite` gir
-- bestillingen et fysisk sted. `BookingRequest.visitId` peker på visitten som
-- ble opprettet ved bekreftelse, slik at kontoret kan flytte og avlyse samme
-- tidsblokk uten å gjette ut fra oppdragets datoer.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "BookingEventType" ADD VALUE 'CONFIRMED';
ALTER TYPE "BookingEventType" ADD VALUE 'EXPIRED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "BookingRequestStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "BookingRequestStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "BookingRequest" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "serviceType" TEXT,
ADD COLUMN     "siteId" TEXT,
ADD COLUMN     "visitId" TEXT;

-- CreateTable
CREATE TABLE "CustomerSite" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "postalCode" TEXT,
    "city" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingHold" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "siteId" TEXT,
    "technicianId" TEXT,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerSite_customerId_idx" ON "CustomerSite"("customerId");

-- CreateIndex
CREATE INDEX "CustomerSite_customerId_isPrimary_idx" ON "CustomerSite"("customerId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSite_customerId_name_key" ON "CustomerSite"("customerId", "name");

-- CreateIndex
-- Minst ett sted kan være primært, men aldri mer enn ett per kunde. Dette er
-- en partiell unik indeks fordi Prisma ikke uttrykker `WHERE isPrimary` i
-- datamodellen; den håndheves derfor i migrasjonen.
CREATE UNIQUE INDEX "CustomerSite_one_primary_per_customer" ON "CustomerSite"("customerId") WHERE "isPrimary" = true;

-- CreateIndex
CREATE UNIQUE INDEX "BookingHold_token_key" ON "BookingHold"("token");

-- CreateIndex
CREATE INDEX "BookingHold_expiresAt_idx" ON "BookingHold"("expiresAt");

-- CreateIndex
CREATE INDEX "BookingHold_customerId_expiresAt_idx" ON "BookingHold"("customerId", "expiresAt");

-- CreateIndex
CREATE INDEX "BookingHold_technicianId_startsAt_endsAt_idx" ON "BookingHold"("technicianId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "BookingHold_siteId_idx" ON "BookingHold"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingRequest_visitId_key" ON "BookingRequest"("visitId");

-- CreateIndex
CREATE INDEX "BookingRequest_status_createdAt_idx" ON "BookingRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BookingRequest_siteId_idx" ON "BookingRequest"("siteId");

-- AddForeignKey
ALTER TABLE "CustomerSite" ADD CONSTRAINT "CustomerSite_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CustomerSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CustomerSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingHold" ADD CONSTRAINT "BookingHold_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
