-- CreateTable
CREATE TABLE "MapSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'osm',
    "apiKey" TEXT,
    "defaultLayer" TEXT NOT NULL DEFAULT 'osm',
    "defaultZoom" INTEGER NOT NULL DEFAULT 6,
    "centerLat" DOUBLE PRECISION,
    "centerLng" DOUBLE PRECISION,
    "scrollWheelZoom" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapSettings_pkey" PRIMARY KEY ("id")
);

