-- Midlertidig lagring (kladd) av sjekklister.
--
-- Én kladd per bruker, oppdrag og mal. Kladden slettes når rapporten lagres.

CREATE TABLE "ReportDraft" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dataJson" TEXT NOT NULL,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportDraft_workOrderId_templateId_userId_key" ON "ReportDraft"("workOrderId", "templateId", "userId");
CREATE INDEX "ReportDraft_workOrderId_idx" ON "ReportDraft"("workOrderId");
CREATE INDEX "ReportDraft_userId_idx" ON "ReportDraft"("userId");

ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportDraft" ADD CONSTRAINT "ReportDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
