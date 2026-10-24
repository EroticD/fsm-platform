-- Avdelinger og utvidede rettigheter.
--
-- Eksisterende brukere, oppdrag og serviceavtaler flyttes til en
-- standardavdeling, slik at ingen data forsvinner når oppdrag og avtaler blir
-- avdelingsbundne.

CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");
CREATE INDEX "Department_isActive_idx" ON "Department"("isActive");

ALTER TABLE "User" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "User" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "WorkOrder" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "Contract" ADD COLUMN "departmentId" TEXT;

INSERT INTO "Department" (
    "id",
    "name",
    "description",
    "isActive",
    "isDefault",
    "createdAt",
    "updatedAt"
)
VALUES (
    'dep_hovedavdeling',
    'Hovedavdeling',
    'Standardavdeling opprettet ved innføring av avdelinger.',
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

UPDATE "User"
SET "departmentId" = (
    SELECT "id" FROM "Department"
    ORDER BY "isDefault" DESC, "createdAt" ASC
    LIMIT 1
)
WHERE "departmentId" IS NULL;

UPDATE "WorkOrder"
SET "departmentId" = (
    SELECT "id" FROM "Department"
    ORDER BY "isDefault" DESC, "createdAt" ASC
    LIMIT 1
)
WHERE "departmentId" IS NULL;

UPDATE "Contract"
SET "departmentId" = (
    SELECT "id" FROM "Department"
    ORDER BY "isDefault" DESC, "createdAt" ASC
    LIMIT 1
)
WHERE "departmentId" IS NULL;

ALTER TABLE "WorkOrder" ALTER COLUMN "departmentId" SET NOT NULL;
ALTER TABLE "Contract" ALTER COLUMN "departmentId" SET NOT NULL;

CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");
CREATE INDEX "WorkOrder_departmentId_idx" ON "WorkOrder"("departmentId");
CREATE INDEX "Contract_departmentId_idx" ON "Contract"("departmentId");

ALTER TABLE "User"
    ADD CONSTRAINT "User_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkOrder"
    ADD CONSTRAINT "WorkOrder_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Contract"
    ADD CONSTRAINT "Contract_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
