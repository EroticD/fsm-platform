-- Spor hvilke visiter lukkingen av oppdraget selv lukket eller kansellerte.
-- Gjenåpning skal bare gjenopprette disse, ikke visiter noen kansellerte
-- manuelt (for eksempel «kunden var ikke hjemme»).
ALTER TABLE "Visit" ADD COLUMN "autoClosedAt" TIMESTAMPTZ(3);
