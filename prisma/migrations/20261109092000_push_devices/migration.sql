-- Pushvarsler: registrerte mobilenheter og vedvarende utboks.
--
-- Addisjonen er bakoverkompatibel. Eksisterende varsler får ingen push-rader
-- automatisk; bare nye varsler køes. Tokenet er unikt per plattform, slik at
-- en ny innlogging på samme enhet flytter eierskapet i stedet for å lage en
-- duplikat.

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "appVersion" TEXT,
    "deviceId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushMessage" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "notificationId" TEXT,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "path" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "errorCode" TEXT,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_platform_token_key" ON "PushDevice"("platform", "token");

-- CreateIndex
CREATE INDEX "PushDevice_userId_active_idx" ON "PushDevice"("userId", "active");

-- CreateIndex
CREATE INDEX "PushDevice_active_lastSeenAt_idx" ON "PushDevice"("active", "lastSeenAt");

-- CreateIndex
CREATE INDEX "PushDevice_deviceId_idx" ON "PushDevice"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "PushMessage_idempotencyKey_key" ON "PushMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PushMessage_status_nextAttemptAt_idx" ON "PushMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "PushMessage_userId_createdAt_idx" ON "PushMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PushMessage_deviceId_status_idx" ON "PushMessage"("deviceId", "status");

-- CreateIndex
CREATE INDEX "PushMessage_notificationId_idx" ON "PushMessage"("notificationId");

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushMessage" ADD CONSTRAINT "PushMessage_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushMessage" ADD CONSTRAINT "PushMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushMessage" ADD CONSTRAINT "PushMessage_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PushDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
