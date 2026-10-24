-- DropForeignKey
ALTER TABLE "Material" DROP CONSTRAINT "Material_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "TimeEntry" DROP CONSTRAINT "TimeEntry_userId_fkey";

-- DropForeignKey
ALTER TABLE "TimeEntry" DROP CONSTRAINT "TimeEntry_workOrderId_fkey";

-- AlterTable
ALTER TABLE "Contract" DROP COLUMN "hourlyRate";

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "hourlyRate";

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "orderNumber" TEXT;

-- DropTable
DROP TABLE "Material";

-- DropTable
DROP TABLE "TimeEntry";

-- CreateIndex
CREATE INDEX "WorkOrder_orderNumber_idx" ON "WorkOrder"("orderNumber");

