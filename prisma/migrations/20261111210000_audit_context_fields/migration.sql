-- Revisjonsraden skal kunne svare på hvem, hvorfra, med hvilket resultat og
-- hvor lenge den skal bevares. Feltene er valgfrie slik at eldre rader består.
ALTER TABLE "AuditLog" ADD COLUMN "ip" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "requestId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "outcome" TEXT NOT NULL DEFAULT 'SUCCESS';
ALTER TABLE "AuditLog" ADD COLUMN "actionCode" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "retentionClass" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "targetUserId" TEXT;

CREATE INDEX "AuditLog_actionCode_idx" ON "AuditLog"("actionCode");
CREATE INDEX "AuditLog_outcome_createdAt_idx" ON "AuditLog"("outcome", "createdAt");
CREATE INDEX "AuditLog_retentionClass_createdAt_idx" ON "AuditLog"("retentionClass", "createdAt");

-- Bokføringsloven § 13 krever fem års oppbevaring av regnskapsmateriale.
-- Retensjonsjobben bruker klassen; dette er dokumentasjon, ikke håndheving.
COMMENT ON COLUMN "AuditLog"."retentionClass" IS 'ACCOUNTING_5Y | SECURITY_1Y | OPS_90D | NULL (global standard)';
