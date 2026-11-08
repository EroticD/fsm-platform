-- Manuell rute-rekkefølge per arbeidsdag. Null/0 betyr automatisk rekkefølge.
ALTER TABLE "Visit" ADD COLUMN "routeSequence" INTEGER;
