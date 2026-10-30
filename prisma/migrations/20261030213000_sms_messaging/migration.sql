-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'nb';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "bodyKey" TEXT,
ADD COLUMN     "params" JSONB,
ADD COLUMN     "titleKey" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'nb';

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "provider" TEXT NOT NULL DEFAULT 'console',
    "providerId" TEXT,
    "to" TEXT NOT NULL,
    "from" TEXT,
    "body" TEXT NOT NULL,
    "templateKey" TEXT,
    "locale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "workOrderId" TEXT,
    "contactId" TEXT,
    "userId" TEXT,
    "departmentId" TEXT,
    "threadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "deadLetteredAt" TIMESTAMP(3),

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageThread" (
    "id" TEXT NOT NULL,
    "threadKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "departmentId" TEXT,
    "workOrderId" TEXT,
    "contactId" TEXT,
    "subject" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "body" TEXT NOT NULL,
    "authorUserId" TEXT,
    "smsMessageId" TEXT,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelPreference" (
    "id" TEXT NOT NULL,
    "contactId" TEXT,
    "userId" TEXT,
    "customerId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "optedIn" BOOLEAN NOT NULL DEFAULT false,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "consentedAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsTemplate" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'nb',
    "body" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultLocale" TEXT NOT NULL DEFAULT 'nb',
    "optOutKeywords" TEXT[] DEFAULT ARRAY['STOP', 'STOPP', 'MELD AV', 'AVMELD', 'UNSUBSCRIBE']::TEXT[],
    "optInKeywords" TEXT[] DEFAULT ARRAY['START', 'JA', 'MELD PÅ', 'PÅMELD', 'SUBSCRIBE']::TEXT[],
    "monthlyCap" INTEGER DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsMessage_status_nextAttemptAt_idx" ON "SmsMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "SmsMessage_status_createdAt_idx" ON "SmsMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_contactId_createdAt_idx" ON "SmsMessage"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_workOrderId_createdAt_idx" ON "SmsMessage"("workOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_threadId_createdAt_idx" ON "SmsMessage"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_provider_providerId_key" ON "SmsMessage"("provider", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageThread_threadKey_key" ON "MessageThread"("threadKey");

-- CreateIndex
CREATE INDEX "MessageThread_customerId_lastMessageAt_idx" ON "MessageThread"("customerId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MessageThread_departmentId_lastMessageAt_idx" ON "MessageThread"("departmentId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "MessageThread_workOrderId_idx" ON "MessageThread"("workOrderId");

-- CreateIndex
CREATE INDEX "MessageThread_contactId_idx" ON "MessageThread"("contactId");

-- CreateIndex
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_smsMessageId_idx" ON "Message"("smsMessageId");

-- CreateIndex
CREATE INDEX "Message_authorUserId_idx" ON "Message"("authorUserId");

-- CreateIndex
CREATE INDEX "ChannelPreference_customerId_channel_idx" ON "ChannelPreference"("customerId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPreference_contactId_channel_key" ON "ChannelPreference"("contactId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPreference_userId_channel_key" ON "ChannelPreference"("userId", "channel");

-- CreateIndex
CREATE INDEX "SmsTemplate_eventKey_isActive_idx" ON "SmsTemplate"("eventKey", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SmsTemplate_eventKey_locale_key" ON "SmsTemplate"("eventKey", "locale");

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPreference" ADD CONSTRAINT "ChannelPreference_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelPreference" ADD CONSTRAINT "ChannelPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SMS og toveismeldinger (Phase 5B).
--
-- Standardmalene seedes her fordi de er data, ikke UI-tekst: de redigeres i
-- innstillingene og kan oversettes uten en ny migrering. Variabellisten er den
-- samme hvite listen som tjenestelaget håndhever.
INSERT INTO "SmsSetting" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "SmsTemplate" ("id", "eventKey", "locale", "body", "variables", "isActive", "updatedAt") VALUES
  ('sms-tpl-booking-confirmed-nb', 'BOOKING_CONFIRMED', 'nb', 'Hei {contactName}! Vi har mottatt bestillingen for {workOrderTitle} den {date} kl. {time}. Referanse: {reference}. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-booking-confirmed-en', 'BOOKING_CONFIRMED', 'en', 'Hi {contactName}! We have received your booking for {workOrderTitle} on {date} at {time}. Reference: {reference}. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-booking-confirmed-pl', 'BOOKING_CONFIRMED', 'pl', 'Cześć {contactName}! Otrzymaliśmy rezerwację na {workOrderTitle} dnia {date} o {time}. Numer referencyjny: {reference}. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-booking-confirmed-de', 'BOOKING_CONFIRMED', 'de', 'Hallo {contactName}! Wir haben Ihre Buchung für {workOrderTitle} am {date} um {time} erhalten. Referenz: {reference}. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-visit-reminder-nb', 'VISIT_REMINDER', 'nb', 'Hei {contactName}! Påminnelse: {workOrderTitle} den {date} kl. {time}. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-visit-reminder-en', 'VISIT_REMINDER', 'en', 'Hi {contactName}! Reminder: {workOrderTitle} on {date} at {time}. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-visit-reminder-pl', 'VISIT_REMINDER', 'pl', 'Cześć {contactName}! Przypomnienie: {workOrderTitle} dnia {date} o {time}. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-visit-reminder-de', 'VISIT_REMINDER', 'de', 'Hallo {contactName}! Erinnerung: {workOrderTitle} am {date} um {time}. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-on-my-way-nb', 'ON_MY_WAY', 'nb', 'Hei {contactName}! {technicianName} er på vei til {workOrderTitle}. {trackingUrl}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-on-my-way-en', 'ON_MY_WAY', 'en', 'Hi {contactName}! {technicianName} is on the way to {workOrderTitle}. {trackingUrl}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-on-my-way-pl', 'ON_MY_WAY', 'pl', 'Cześć {contactName}! {technicianName} jest w drodze do {workOrderTitle}. {trackingUrl}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-on-my-way-de', 'ON_MY_WAY', 'de', 'Hallo {contactName}! {technicianName} ist auf dem Weg zu {workOrderTitle}. {trackingUrl}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-visit-done-nb', 'VISIT_DONE', 'nb', 'Hei {contactName}! Vi har fullført {workOrderTitle}. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-visit-done-en', 'VISIT_DONE', 'en', 'Hi {contactName}! We have completed {workOrderTitle}. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-visit-done-pl', 'VISIT_DONE', 'pl', 'Cześć {contactName}! Zakończyliśmy {workOrderTitle}. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-visit-done-de', 'VISIT_DONE', 'de', 'Hallo {contactName}! Wir haben {workOrderTitle} abgeschlossen. {companyName}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-review-request-nb', 'REVIEW_REQUEST', 'nb', 'Hei {contactName}! Hvordan gikk {workOrderTitle}? Gi oss en vurdering: {reviewUrl}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-review-request-en', 'REVIEW_REQUEST', 'en', 'Hi {contactName}! How did {workOrderTitle} go? Leave us a review: {reviewUrl}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-review-request-pl', 'REVIEW_REQUEST', 'pl', 'Cześć {contactName}! Jak poszło {workOrderTitle}? Zostaw opinię: {reviewUrl}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP),
  ('sms-tpl-review-request-de', 'REVIEW_REQUEST', 'de', 'Hallo {contactName}! Wie lief {workOrderTitle}? Hinterlassen Sie uns eine Bewertung: {reviewUrl}', ARRAY['contactName','customerName','companyName','workOrderTitle','date','time','reference','technicianName','trackingUrl','reviewUrl']::TEXT[], true, CURRENT_TIMESTAMP)
ON CONFLICT ("eventKey", "locale") DO NOTHING;
