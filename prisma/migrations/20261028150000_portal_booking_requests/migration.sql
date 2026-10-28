-- R2-33: kundens bestillingsforespørsel med ønsket tid, utstyr,
-- kontaktperson og synlig endringshistorikk.

-- CreateEnum
CREATE TYPE "BookingRequestStatus" AS ENUM ('PENDING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingEventType" AS ENUM ('CREATED', 'RESCHEDULED', 'CANCELLED');

-- CreateTable
CREATE TABLE "BookingRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "requestedDate" DATE NOT NULL,
    "requestedFrom" TEXT NOT NULL,
    "requestedTo" TEXT NOT NULL,
    "equipmentId" TEXT,
    "equipmentLabel" TEXT,
    "preferredTechnicianId" TEXT,
    "preferredTechnicianName" TEXT,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "status" "BookingRequestStatus" NOT NULL DEFAULT 'PENDING',
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingRequestEvent" (
    "id" TEXT NOT NULL,
    "bookingRequestId" TEXT NOT NULL,
    "type" "BookingEventType" NOT NULL,
    "message" TEXT,
    "requestedDate" DATE,
    "requestedFrom" TEXT,
    "requestedTo" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingRequest_reference_key" ON "BookingRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "BookingRequest_workOrderId_key" ON "BookingRequest"("workOrderId");

-- CreateIndex
CREATE INDEX "BookingRequest_customerId_createdAt_idx" ON "BookingRequest"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingRequestEvent_bookingRequestId_createdAt_idx" ON "BookingRequestEvent"("bookingRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRequestEvent" ADD CONSTRAINT "BookingRequestEvent_bookingRequestId_fkey" FOREIGN KEY ("bookingRequestId") REFERENCES "BookingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
