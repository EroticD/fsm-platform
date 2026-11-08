-- SAML 2.0, SCIM-grupper og feltnivå-RBAC v1.
--
-- Endringen er additiv: eksisterende SSO-identiteter, SCIM-tokens og
-- brukerrader er urørt. SCIM-grupper gir bare tilgang gjennom eksplisitt
-- mapping, og SAML-cachen gjør AuthnRequest-id-er og replay-vakter delbare
-- mellom appinstanser.

CREATE TABLE "ScimGroup" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "externalId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScimGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScimGroupMember" (
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimGroupMember_pkey" PRIMARY KEY ("groupId","userId")
);

CREATE TABLE "SamlCacheEntry" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamlCacheEntry_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "ScimGroup_displayName_key" ON "ScimGroup"("displayName");
CREATE UNIQUE INDEX "ScimGroup_externalId_key" ON "ScimGroup"("externalId");
CREATE INDEX "ScimGroup_createdAt_idx" ON "ScimGroup"("createdAt");
CREATE INDEX "ScimGroupMember_userId_idx" ON "ScimGroupMember"("userId");
CREATE INDEX "SamlCacheEntry_expiresAt_idx" ON "SamlCacheEntry"("expiresAt");

ALTER TABLE "ScimGroupMember" ADD CONSTRAINT "ScimGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ScimGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScimGroupMember" ADD CONSTRAINT "ScimGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
