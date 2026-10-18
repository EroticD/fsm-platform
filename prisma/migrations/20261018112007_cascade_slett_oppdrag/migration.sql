-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "JobComment" DROP CONSTRAINT "JobComment_workOrderId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_workOrderId_fkey";

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobComment" ADD CONSTRAINT "JobComment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
