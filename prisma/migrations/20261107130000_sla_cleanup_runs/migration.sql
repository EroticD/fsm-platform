-- Kjøringslogg for den automatiske SLA-oppryddingen.
--
-- Hver kjøring får én rad, slik at /api/metrics kan vise siste kjøring,
-- kansellert antall og feilede kjøringer. Selve kanselleringene revisjonslogges
-- per SlaClock i samme transaksjon som de skrives.

-- CreateTable
CREATE TABLE "SlaCleanupRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "kept" INTEGER NOT NULL DEFAULT 0,
    "cancelled" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "SlaCleanupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlaCleanupRun_startedAt_idx" ON "SlaCleanupRun"("startedAt");

-- CreateIndex
CREATE INDEX "SlaCleanupRun_status_startedAt_idx" ON "SlaCleanupRun"("status", "startedAt");
