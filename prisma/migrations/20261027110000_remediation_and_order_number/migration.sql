-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "deviationSourceKey" TEXT,
ADD COLUMN     "orderNumberNormalized" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_deviationSourceKey_key" ON "WorkOrder"("deviationSourceKey");

-- CreateIndex
CREATE INDEX "WorkOrder_orderNumberNormalized_idx" ON "WorkOrder"("orderNumberNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_departmentId_orderNumberNormalized_key" ON "WorkOrder"("departmentId", "orderNumberNormalized");

