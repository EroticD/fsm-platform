-- Konfigurerbare oppdragsstatuser: funksjon (åpen/planlagt/lukket), rekkefølge
-- og om statusen er valgbar. Selve WorkStatus-verdiene er uendret.
CREATE TYPE "WorkOrderStatusCategory" AS ENUM ('OPEN', 'PLANNED', 'CLOSED');

CREATE TABLE "WorkOrderStatusSetting" (
    "status" "WorkStatus" NOT NULL,
    "category" "WorkOrderStatusCategory" NOT NULL DEFAULT 'OPEN',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "WorkOrderStatusSetting_pkey" PRIMARY KEY ("status")
);

CREATE TABLE "WorkOrderSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultStatus" "WorkStatus" NOT NULL DEFAULT 'PENDING',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "WorkOrderSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "WorkOrderStatusSetting" ("status", "category", "sortOrder", "isActive", "updatedAt") VALUES
  ('OPEN', 'OPEN', 10, true, CURRENT_TIMESTAMP),
  ('PENDING', 'OPEN', 20, true, CURRENT_TIMESTAMP),
  ('PLANNED', 'PLANNED', 30, true, CURRENT_TIMESTAMP),
  ('WAITING', 'PLANNED', 40, true, CURRENT_TIMESTAMP),
  ('IN_PROGRESS', 'PLANNED', 50, true, CURRENT_TIMESTAMP),
  ('COMPLETED', 'CLOSED', 60, true, CURRENT_TIMESTAMP),
  ('CANCELLED', 'CLOSED', 70, true, CURRENT_TIMESTAMP);

INSERT INTO "WorkOrderSettings" ("id", "defaultStatus", "updatedAt")
VALUES ('default', 'PENDING', CURRENT_TIMESTAMP);
