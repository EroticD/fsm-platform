-- Installasjonsnivåmoduler.
--
-- Tabellen er additiv og fjerner ingen data. Radene opprettes ved første
-- lesing (eller av seed/preset-skriptet): eksisterende installasjoner får alle
-- leverte moduler på, mens nye installasjoner kan starte med MODULE_PRESET=core.
-- Data i modultabellene slettes aldri når en modul slås av.

CREATE TABLE "ModuleState" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "ModuleState_pkey" PRIMARY KEY ("key")
);
