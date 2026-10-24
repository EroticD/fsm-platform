-- Serviceavtaler med faste intervaller og kundeverlegg.
--
-- Contract.interval var tidligere fritekst. Den erstattes av et tallfelt med
-- måneder, slik at generatoren kan regne ut neste service. Eventuelle gamle
-- verdier mappes til nærmeste gyldige intervall før kolonnen fjernes.

-- AlterTable: nye felt på Contract
ALTER TABLE "Contract" ADD COLUMN "intervalMonths" INTEGER;
ALTER TABLE "Contract" ADD COLUMN "nextServiceDate" TIMESTAMP(3);
ALTER TABLE "Contract" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Contract" ADD COLUMN "contactId" TEXT;
ALTER TABLE "Contract" ADD COLUMN "templateId" TEXT;

-- Backfill: gamle intervalltekster som «3 mnd», «12 måneder» osv.
UPDATE "Contract"
SET "intervalMonths" = CASE
  WHEN "interval" ~ '(^|[^0-9])24([^0-9]|$)' THEN 24
  WHEN "interval" ~ '(^|[^0-9])12([^0-9]|$)' THEN 12
  WHEN "interval" ~ '(^|[^0-9])6([^0-9]|$)' THEN 6
  WHEN "interval" ~ '(^|[^0-9])3([^0-9]|$)' THEN 3
  ELSE 12
END;

-- Eksisterende avtaler får startdatoen som neste service. Bakgrunnsjobben
-- flytter dem videre til første framtidige forekomst ved første kjøring.
UPDATE "Contract" SET "nextServiceDate" = "startDate";

ALTER TABLE "Contract" ALTER COLUMN "intervalMonths" SET NOT NULL;
ALTER TABLE "Contract" ALTER COLUMN "nextServiceDate" SET NOT NULL;
ALTER TABLE "Contract" DROP COLUMN "interval";

-- AlterTable: kobling fra oppdrag til serviceavtale
ALTER TABLE "WorkOrder" ADD COLUMN "contractId" TEXT;

-- CreateTable: vedlegg på kundekortet
CREATE TABLE "CustomerAttachment" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "dataUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "CustomerAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerAttachment_customerId_idx" ON "CustomerAttachment"("customerId");
CREATE INDEX "Contract_nextServiceDate_idx" ON "Contract"("nextServiceDate");
CREATE INDEX "WorkOrder_contractId_idx" ON "WorkOrder"("contractId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerAttachment" ADD CONSTRAINT "CustomerAttachment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
