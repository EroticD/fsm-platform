-- Live sporing og kundeomtaler (Phase 5C).
--
-- Sporing er av som standard per avdeling. Nye statustidspunkt på Visit gjør
-- at ETA og rapportering kan bruke faktiske hendelser i stedet for updatedAt.
-- Bare SHA-256-hasher av sporings- og omtaletokens lagres.

-- AlterTable
ALTER TABLE "Department" ADD COLUMN "trackingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Visit"
  ADD COLUMN "doneAt" TIMESTAMPTZ(3),
  ADD COLUMN "enRouteAt" TIMESTAMPTZ(3),
  ADD COLUMN "onSiteAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "TrackingLink" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TrackingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitLocationPing" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitLocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "visitId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "score" INTEGER,
    "comment" TEXT,
    "requestedAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackingLink_tokenHash_key" ON "TrackingLink"("tokenHash");

-- CreateIndex
CREATE INDEX "TrackingLink_visitId_revokedAt_idx" ON "TrackingLink"("visitId", "revokedAt");

-- CreateIndex
CREATE INDEX "TrackingLink_workOrderId_idx" ON "TrackingLink"("workOrderId");

-- CreateIndex
CREATE INDEX "TrackingLink_expiresAt_idx" ON "TrackingLink"("expiresAt");

-- CreateIndex
CREATE INDEX "VisitLocationPing_visitId_recordedAt_idx" ON "VisitLocationPing"("visitId", "recordedAt");

-- CreateIndex
CREATE INDEX "VisitLocationPing_recordedAt_idx" ON "VisitLocationPing"("recordedAt");

-- CreateIndex
CREATE INDEX "VisitLocationPing_userId_idx" ON "VisitLocationPing"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_visitId_key" ON "Review"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_tokenHash_key" ON "Review"("tokenHash");

-- CreateIndex
CREATE INDEX "Review_workOrderId_submittedAt_idx" ON "Review"("workOrderId", "submittedAt");

-- CreateIndex
CREATE INDEX "Review_submittedAt_score_idx" ON "Review"("submittedAt", "score");

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingLink" ADD CONSTRAINT "TrackingLink_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitLocationPing" ADD CONSTRAINT "VisitLocationPing_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitLocationPing" ADD CONSTRAINT "VisitLocationPing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
