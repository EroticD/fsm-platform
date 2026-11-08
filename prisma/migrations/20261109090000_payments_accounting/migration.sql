-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('NONE', 'PENDING', 'PAID', 'PARTIALLY_PAID', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AccountingSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'EXPORTED', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ONLINE';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "paymentLinkCreatedAt" TIMESTAMP(3),
ADD COLUMN     "paymentLinkId" TEXT,
ADD COLUMN     "paymentLinkUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "paymentLinkUrl" TEXT,
ADD COLUMN     "paymentProvider" TEXT,
ADD COLUMN     "paymentStatus" "PaymentLinkStatus" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerEventId" TEXT,
ADD COLUMN     "providerReference" TEXT;

-- CreateTable
CREATE TABLE "AccountingSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'csv',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,

    CONSTRAINT "AccountingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingCustomer" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingSync" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "AccountingSyncStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "externalCustomerId" TEXT,
    "externalInvoiceId" TEXT,
    "externalInvoiceNumber" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingPayment" (
    "id" TEXT NOT NULL,
    "syncId" TEXT NOT NULL,
    "paymentId" TEXT,
    "provider" TEXT NOT NULL,
    "status" "AccountingSyncStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "externalId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingCustomer_provider_externalId_idx" ON "AccountingCustomer"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingCustomer_customerId_provider_key" ON "AccountingCustomer"("customerId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingSync_idempotencyKey_key" ON "AccountingSync"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AccountingSync_provider_status_idx" ON "AccountingSync"("provider", "status");

-- CreateIndex
CREATE INDEX "AccountingSync_lastAttemptAt_idx" ON "AccountingSync"("lastAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingSync_invoiceId_provider_key" ON "AccountingSync"("invoiceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPayment_idempotencyKey_key" ON "AccountingPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AccountingPayment_provider_status_idx" ON "AccountingPayment"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPayment_syncId_paymentId_key" ON "AccountingPayment"("syncId", "paymentId");

-- CreateIndex
CREATE INDEX "Invoice_paymentProvider_paymentLinkId_idx" ON "Invoice"("paymentProvider", "paymentLinkId");

-- CreateIndex
CREATE INDEX "Invoice_paymentStatus_idx" ON "Invoice"("paymentStatus");

-- CreateIndex
CREATE INDEX "Payment_provider_providerReference_idx" ON "Payment"("provider", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerEventId_key" ON "Payment"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "AccountingCustomer" ADD CONSTRAINT "AccountingCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingSync" ADD CONSTRAINT "AccountingSync_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPayment" ADD CONSTRAINT "AccountingPayment_syncId_fkey" FOREIGN KEY ("syncId") REFERENCES "AccountingSync"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingPayment" ADD CONSTRAINT "AccountingPayment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

