-- Automatiske påminnelser (SMS/e-post) før planlagte visiter.
--
-- Reglene er per avdeling, slik at 24-timers- og 2-timersvarsel kan
-- konfigureres hver for seg. Utsendelsesloggen er vedvarende og idempotent:
-- dedupeKey gjør at samme regel/visit/starttid bare planlegges én gang.

-- CreateTable
CREATE TABLE "ReminderRule" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "offsetHours" INTEGER NOT NULL DEFAULT 24,
    "templateKey" TEXT NOT NULL DEFAULT 'VISIT_REMINDER',
    "quietStartHour" INTEGER,
    "quietEndHour" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Oslo',
    "maxPerVisit" INTEGER NOT NULL DEFAULT 2,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderDispatch" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "departmentId" TEXT,
    "workOrderId" TEXT,
    "customerId" TEXT,
    "contactId" TEXT,
    "channel" TEXT NOT NULL,
    "offsetHours" INTEGER NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'nb',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "visitStartsAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "skipReason" TEXT,
    "smsMessageId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReminderRule_departmentId_channel_offsetHours_key" ON "ReminderRule"("departmentId", "channel", "offsetHours");

-- CreateIndex
CREATE INDEX "ReminderRule_departmentId_isActive_idx" ON "ReminderRule"("departmentId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDispatch_dedupeKey_key" ON "ReminderDispatch"("dedupeKey");

-- CreateIndex
CREATE INDEX "ReminderDispatch_status_nextAttemptAt_idx" ON "ReminderDispatch"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ReminderDispatch_status_scheduledFor_idx" ON "ReminderDispatch"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "ReminderDispatch_visitId_status_idx" ON "ReminderDispatch"("visitId", "status");

-- CreateIndex
CREATE INDEX "ReminderDispatch_departmentId_createdAt_idx" ON "ReminderDispatch"("departmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReminderRule" ADD CONSTRAINT "ReminderRule_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDispatch" ADD CONSTRAINT "ReminderDispatch_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ReminderRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDispatch" ADD CONSTRAINT "ReminderDispatch_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderDispatch" ADD CONSTRAINT "ReminderDispatch_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
