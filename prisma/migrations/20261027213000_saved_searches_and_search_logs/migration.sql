-- Lagrede søk og søkelogg ble lagt til i Prisma-skjemaet sammen med
-- søkeindeksene, men manglet en migrering. Tabellene opprettes idempotent slik
-- at migreringen også kan kjøres på en database der de allerede finnes.

CREATE TABLE IF NOT EXISTS "SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "filters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SearchLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "query" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "filters" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SavedSearch_userId_updatedAt_idx" ON "SavedSearch"("userId", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SavedSearch_userId_name_key" ON "SavedSearch"("userId", "name");

CREATE INDEX IF NOT EXISTS "SearchLog_createdAt_idx" ON "SearchLog"("createdAt");
CREATE INDEX IF NOT EXISTS "SearchLog_resultCount_createdAt_idx" ON "SearchLog"("resultCount", "createdAt");
CREATE INDEX IF NOT EXISTS "SearchLog_normalizedQuery_createdAt_idx" ON "SearchLog"("normalizedQuery", "createdAt");
CREATE INDEX IF NOT EXISTS "SearchLog_userId_createdAt_idx" ON "SearchLog"("userId", "createdAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SavedSearch_userId_fkey') THEN
        ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SearchLog_userId_fkey') THEN
        ALTER TABLE "SearchLog" ADD CONSTRAINT "SearchLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
