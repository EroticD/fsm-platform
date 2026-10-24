-- P1-1: indekser, tidsstempler og dataintegritet.
--
-- Kjørt på forhånd mot eksisterende data:
--   * ingen duplikate (contractId, scheduledFor)
--   * ReportUnit.status inneholder bare GODKJENT/AVVIK
--   * nøyaktig én Department.isDefault = true
--   * ingen ugyldige Contract.intervalMonths
--
-- Constraints legges til slutt, slik at en eventuell datakonflikt feiler
-- migreringen i stedet for å slette forretningsdata.

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Contact_customerId_idx" ON "Contact"("customerId");

-- CreateIndex
CREATE INDEX "Contract_isActive_nextServiceDate_idx" ON "Contract"("isActive", "nextServiceDate");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "Customer_customerNumber_idx" ON "Customer"("customerNumber");

-- CreateIndex
CREATE INDEX "Product_customerId_serialNumber_idx" ON "Product"("customerId", "serialNumber");

-- CreateIndex
CREATE INDEX "Report_completedAt_idx" ON "Report"("completedAt");

-- CreateIndex
CREATE INDEX "Report_workOrderId_createdAt_idx" ON "Report"("workOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "User_resetToken_idx" ON "User"("resetToken");

-- CreateIndex
CREATE INDEX "User_customerId_idx" ON "User"("customerId");

-- CreateIndex
CREATE INDEX "WorkOrder_scheduledTo_idx" ON "WorkOrder"("scheduledTo");

-- CreateIndex
CREATE INDEX "WorkOrder_departmentId_status_scheduledFor_idx" ON "WorkOrder"("departmentId", "status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_contractId_scheduledFor_key" ON "WorkOrder"("contractId", "scheduledFor");

-- P1-1: forretningsregler som Prisma ikke kan uttrykke.
ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_interval_check"
  CHECK ("intervalMonths" IN (3, 6, 12, 24));

CREATE UNIQUE INDEX "Department_one_default"
  ON "Department" ("isDefault") WHERE "isDefault" = true;

ALTER TABLE "ReportUnit"
  ADD CONSTRAINT "ReportUnit_status_check"
  CHECK ("status" IN ('GODKJENT', 'AVVIK'));
