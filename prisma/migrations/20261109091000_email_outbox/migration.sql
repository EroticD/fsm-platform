-- Vedvarende utboks for transaksjons-e-post.
--
-- Automatiske hendelser (tilbud, faktura, betaling, booking og tildeling)
-- legger en rad her i stedet for å sende SMTP i request-stien. Jobbworkeren
-- henter én rad med FOR UPDATE SKIP LOCKED, slik at flere instanser kan dele
-- køen uten å sende samme e-post to ganger. idempotencyKey er unik og gjør
-- enqueue idempotent.

-- CreateEnum
CREATE TYPE "EmailMessageStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'nb',
    "status" "EmailMessageStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "fromName" TEXT,
    "fromAddress" TEXT,
    "replyTo" TEXT,
    "quoteSent" BOOLEAN NOT NULL DEFAULT true,
    "invoiceSent" BOOLEAN NOT NULL DEFAULT true,
    "paymentReceived" BOOLEAN NOT NULL DEFAULT true,
    "bookingRequested" BOOLEAN NOT NULL DEFAULT true,
    "bookingConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "bookingCancelled" BOOLEAN NOT NULL DEFAULT true,
    "workOrderAssigned" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,

    CONSTRAINT "EmailSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_idempotencyKey_key" ON "EmailMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailMessage_status_nextAttemptAt_idx" ON "EmailMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailMessage_status_lockedAt_idx" ON "EmailMessage"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "EmailMessage_createdAt_idx" ON "EmailMessage"("createdAt");
