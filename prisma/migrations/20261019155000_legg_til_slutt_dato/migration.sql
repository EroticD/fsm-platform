-- Legger til sluttdato for oppdrag som varer over flere dager.
-- Feltet er inklusivt: scheduledTo = samme dag som scheduledFor betyr éndagsoppdrag.
ALTER TABLE "WorkOrder" ADD COLUMN "scheduledTo" TIMESTAMP(3);
