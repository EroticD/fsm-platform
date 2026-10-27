-- Rapporter uten enheter har ingen enhet å godkjenne eller melde avvik på.
-- Den anonyme svarraden får derfor en nøytral status.
ALTER TABLE "ReportUnit" DROP CONSTRAINT "ReportUnit_status_check";
ALTER TABLE "ReportUnit"
  ADD CONSTRAINT "ReportUnit_status_check"
  CHECK ("status" IN ('GODKJENT', 'AVVIK', 'UTEN_ENHET'));
