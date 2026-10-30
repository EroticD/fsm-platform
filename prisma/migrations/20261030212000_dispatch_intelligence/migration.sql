-- CreateTable
CREATE TABLE "Territory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "postalPrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "municipalityCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "radiusKm" INTEGER,
    "centerLat" DOUBLE PRECISION,
    "centerLng" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapacityPlan" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "technicianId" TEXT,
    "capacityMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapacityPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentPolicy" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SKILLS',
    "weights" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Territory_departmentId_isActive_idx" ON "Territory"("departmentId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Territory_departmentId_name_key" ON "Territory"("departmentId", "name");

-- CreateIndex
CREATE INDEX "CapacityPlan_departmentId_date_idx" ON "CapacityPlan"("departmentId", "date");

-- CreateIndex
CREATE INDEX "CapacityPlan_technicianId_date_idx" ON "CapacityPlan"("technicianId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CapacityPlan_departmentId_date_technicianId_key" ON "CapacityPlan"("departmentId", "date", "technicianId");

-- CreateIndex
CREATE INDEX "AssignmentPolicy_departmentId_isActive_idx" ON "AssignmentPolicy"("departmentId", "isActive");

-- AddForeignKey
ALTER TABLE "Territory" ADD CONSTRAINT "Territory_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapacityPlan" ADD CONSTRAINT "CapacityPlan_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CapacityPlan" ADD CONSTRAINT "CapacityPlan_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentPolicy" ADD CONSTRAINT "AssignmentPolicy_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Avdelingskapasitet har `technicianId = NULL`. PostgreSQL ser på NULL som
-- forskjellig fra NULL i en vanlig unik indeks, så uten denne delvise indeksen
-- kunne samme avdeling og dato få flere «hele avdelingen»-rader.
CREATE UNIQUE INDEX "CapacityPlan_departmentId_date_department_level_key"
  ON "CapacityPlan"("departmentId", "date")
  WHERE "technicianId" IS NULL;

-- Enkle dataintegritetsvakter. Prisma uttrykker ikke CHECK-constraints i
-- schemaet, men de er nyttige mot manuelle importjobber og SQL-feil.
ALTER TABLE "CapacityPlan"
  ADD CONSTRAINT "CapacityPlan_capacityMinutes_nonnegative"
  CHECK ("capacityMinutes" >= 0);

ALTER TABLE "Territory"
  ADD CONSTRAINT "Territory_radiusKm_nonnegative"
  CHECK ("radiusKm" IS NULL OR "radiusKm" >= 0);

ALTER TABLE "AssignmentPolicy"
  ADD CONSTRAINT "AssignmentPolicy_mode_check"
  CHECK ("mode" IN ('SKILLS', 'DISTANCE', 'EARLIEST', 'CUSTOM'));

-- Rettigheter (C-02/N-12): nye nøkler må legges på de seedede rollene.
-- Administrator har alltid alle rettigheter i koden, men raden oppdateres også
-- slik at rolleoversikten viser riktig liste. Kontoret kan konfigurere
-- dispatch-policyer og territorier; montørene skal ikke kunne det.
UPDATE "Role"
SET "permissions" = (
  SELECT ARRAY(
    SELECT DISTINCT unnest("permissions" || ARRAY['dispatch.configure']::TEXT[])
  )
)
WHERE "key" IN ('ADMIN', 'OFFICE');
