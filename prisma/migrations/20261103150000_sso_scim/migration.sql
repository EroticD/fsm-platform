-- SSO-identiteter og SCIM-tokens.
--
-- SSO kobles bare til en eksisterende aktiv bruker med bekreftet e-post, eller
-- opprettes etter eksplisitt auto-provisjonering. `subject` er leverandørens
-- stabile id, ikke e-post, slik at en e-postendring ikke bryter koblingen.
CREATE TABLE "SsoIdentity" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "SsoIdentity_pkey" PRIMARY KEY ("id")
);

-- SCIM-tokens lagrer bare SHA-256-hash og et visningsprefiks. Klarteksttokenet
-- vises én gang ved opprettelse og kan ikke hentes tilbake.
CREATE TABLE "ScimToken" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ScimToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SsoIdentity_provider_subject_key" ON "SsoIdentity"("provider", "subject");
CREATE UNIQUE INDEX "SsoIdentity_provider_userId_key" ON "SsoIdentity"("provider", "userId");
CREATE INDEX "SsoIdentity_userId_idx" ON "SsoIdentity"("userId");

CREATE UNIQUE INDEX "ScimToken_tokenHash_key" ON "ScimToken"("tokenHash");
CREATE INDEX "ScimToken_revokedAt_idx" ON "ScimToken"("revokedAt");
CREATE INDEX "ScimToken_createdById_idx" ON "ScimToken"("createdById");

ALTER TABLE "SsoIdentity" ADD CONSTRAINT "SsoIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SCIM externalId er leverandørens stabile bruker-id. Den er valgfri og unik
-- når den er satt, slik at to SCIM-brukere ikke kan peke på samme eksterne id.
ALTER TABLE "User" ADD COLUMN "scimExternalId" TEXT;
CREATE UNIQUE INDEX "User_scimExternalId_key" ON "User"("scimExternalId");
