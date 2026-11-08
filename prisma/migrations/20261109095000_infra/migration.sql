-- Database-fallback for cache når Redis ikke er konfigurert. Additiv tabell;
-- ingen eksisterende data eller kolonner endres.
CREATE TABLE "InfraCache" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfraCache_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "InfraCache_expiresAt_idx" ON "InfraCache"("expiresAt");
