-- Externe QR-koder som allerede sitter fysisk på utstyret.
-- Product.qrToken er uendret; denne tabellen er bare en mapping fra kundens
-- eksisterende kode til riktig enhet.

CREATE TYPE "EquipmentQrCodeSource" AS ENUM ('MANUAL', 'SCAN', 'IMPORT');

CREATE TABLE "EquipmentQrCode" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "label" TEXT,
    "source" "EquipmentQrCodeSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "lastScannedAt" TIMESTAMP(3),

    CONSTRAINT "EquipmentQrCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquipmentQrCode_normalizedValue_key" ON "EquipmentQrCode"("normalizedValue");
CREATE INDEX "EquipmentQrCode_productId_idx" ON "EquipmentQrCode"("productId");

ALTER TABLE "EquipmentQrCode"
    ADD CONSTRAINT "EquipmentQrCode_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EquipmentQrCode"
    ADD CONSTRAINT "EquipmentQrCode_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
