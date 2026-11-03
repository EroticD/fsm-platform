-- Scopes og skrivebeskyttelse for API-nøkler.
-- Eksisterende nøkler får tom liste, som betyr «alle scopes» og bevarer
-- tilgangen de hadde før migreringen. Nye nøkler får en eksplisitt liste.
ALTER TABLE "ApiKey"
    ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "readOnly" BOOLEAN NOT NULL DEFAULT false;
