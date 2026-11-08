-- Indeks for oppslag fra oppdrag til ekstern ordre (integrasjoner).
CREATE INDEX "ExternalOrder_workOrderId_idx" ON "ExternalOrder"("workOrderId");
