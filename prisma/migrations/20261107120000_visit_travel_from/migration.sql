-- Retur-/viderekjøring per arbeidsdag.
--
-- `doneAt` er når arbeidet på dagen er ferdig. `travelFromEndedAt` er når
-- kjøringen etterpå er avsluttet. Feltet er nullbart: eksisterende visiter får
-- null til de lukkes manuelt («Avslutt kjøring») eller automatisk når
-- montøren starter EN_ROUTE på neste visitt. Det samme tidssegmentet er da
-- returkjøring for forrige oppdrag og tilkjøring for neste.

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN "travelFromEndedAt" TIMESTAMPTZ(3);
