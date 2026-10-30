-- Phase 1: planlagte visiter med tid på dagen, kompetanse, arbeidstid og
-- fravær. Visittens tidsstempler er absolutte tidspunkt (timestamptz).
--
-- Eksisterende oppdrag har bare kalenderdatoer i "scheduledFor"/"scheduledTo".
-- Hvert datoplanlagt oppdrag får én heldagsvisitt som dekker hele perioden.
-- Datoene tolkes som lokal tid i Europe/Oslo, slik at overgangene til og fra
-- sommertid blir riktige (døgnet kan være 23 eller 25 timer).

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('PLANNED', 'ASSIGNED', 'EN_ROUTE', 'ON_SITE', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "status" "VisitStatus" NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitTechnician" (
    "visitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "VisitTechnician_pkey" PRIMARY KEY ("visitId","userId")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSkill" (
    "userId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" INTEGER,
    "validUntil" TIMESTAMP(3),

    CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("userId","skillId")
);

-- CreateTable
CREATE TABLE "WorkOrderSkill" (
    "workOrderId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WorkOrderSkill_pkey" PRIMARY KEY ("workOrderId","skillId")
);

-- CreateTable
CREATE TABLE "UserAvailability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "UserAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visit_workOrderId_startsAt_idx" ON "Visit"("workOrderId", "startsAt");

-- CreateIndex
CREATE INDEX "Visit_startsAt_endsAt_idx" ON "Visit"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Visit_status_idx" ON "Visit"("status");

-- CreateIndex
CREATE INDEX "VisitTechnician_userId_idx" ON "VisitTechnician"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_key_key" ON "Skill"("key");

-- CreateIndex
CREATE INDEX "UserSkill_skillId_idx" ON "UserSkill"("skillId");

-- CreateIndex
CREATE INDEX "WorkOrderSkill_skillId_idx" ON "WorkOrderSkill"("skillId");

-- CreateIndex
CREATE INDEX "UserAvailability_userId_weekday_idx" ON "UserAvailability"("userId", "weekday");

-- CreateIndex
CREATE INDEX "Absence_userId_startsAt_endsAt_idx" ON "Absence"("userId", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitTechnician" ADD CONSTRAINT "VisitTechnician_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitTechnician" ADD CONSTRAINT "VisitTechnician_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderSkill" ADD CONSTRAINT "WorkOrderSkill_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderSkill" ADD CONSTRAINT "WorkOrderSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAvailability" ADD CONSTRAINT "UserAvailability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: én heldagsvisitt per oppdrag som har minst én kalenderdato.
-- "scheduledFor" er startdato og "scheduledTo" siste inkluderte dag; mangler
-- en av dem, brukes den andre. Datoene tolkes eksplisitt som Europe/Oslo.
-- WHERE NOT EXISTS gjør at backfillen kan kjøres på nytt uten duplikater.
WITH backfilled AS (
    INSERT INTO "Visit" (
        "id",
        "workOrderId",
        "sequence",
        "startsAt",
        "endsAt",
        "allDay",
        "status"
    )
    SELECT
        gen_random_uuid()::text,
        w."id",
        0,
        (COALESCE(w."scheduledFor", w."scheduledTo")::timestamp AT TIME ZONE 'Europe/Oslo'),
        ((COALESCE(w."scheduledTo", w."scheduledFor") + 1)::timestamp AT TIME ZONE 'Europe/Oslo'),
        true,
        'PLANNED'::"VisitStatus"
    FROM "WorkOrder" w
    WHERE (w."scheduledFor" IS NOT NULL OR w."scheduledTo" IS NOT NULL)
      AND NOT EXISTS (
          SELECT 1 FROM "Visit" v WHERE v."workOrderId" = w."id"
      )
    RETURNING "id", "workOrderId"
)
-- Kopier montørene fra den implisitte koblingstabellen. Kolonne A er User.id
-- og kolonne B er WorkOrder.id (verifisert med \d "_WorkOrderTechnicians").
INSERT INTO "VisitTechnician" ("visitId", "userId")
SELECT b."id", t."A"
FROM backfilled b
JOIN "_WorkOrderTechnicians" t ON t."B" = b."workOrderId"
ON CONFLICT DO NOTHING;

-- Gjør "scheduledFor"/"scheduledTo" til et komplett, avledet datointervall.
-- Eldre rader kan mangle den ene enden (én-dagsoppdrag har ofte bare
-- "scheduledFor"). Fra nå av speiler feltene min/maks av visitene, og
-- faseporten krever at begge er satt for datoplanlagte oppdrag.
UPDATE "WorkOrder"
SET
    "scheduledFor" = COALESCE("scheduledFor", "scheduledTo"),
    "scheduledTo" = COALESCE("scheduledTo", "scheduledFor")
WHERE ("scheduledFor" IS NOT NULL OR "scheduledTo" IS NOT NULL)
  AND ("scheduledFor" IS NULL OR "scheduledTo" IS NULL);
