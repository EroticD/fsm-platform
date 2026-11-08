-- Kortlevde reserveringer for atomisk opplastingskvote.
--
-- En reservasjon opprettes før filen skrives til endelig mappe og slettes når
-- `Upload`-raden er skrevet eller opplastingen er avvist. Da teller også
-- samtidige opplastinger som ennå ikke har fått metadata mot kvoten.
-- Utløpte rader ignoreres og ryddes av den eksisterende cronjobben.

-- CreateTable
CREATE TABLE "UploadQuotaReservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customerId" TEXT,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadQuotaReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UploadQuotaReservation_userId_expiresAt_idx" ON "UploadQuotaReservation"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "UploadQuotaReservation_customerId_expiresAt_idx" ON "UploadQuotaReservation"("customerId", "expiresAt");

-- CreateIndex
CREATE INDEX "UploadQuotaReservation_expiresAt_idx" ON "UploadQuotaReservation"("expiresAt");
