-- Roller blir førsteklasses data, slik at administrator kan opprette, endre og
-- fjerne roller og redigere rettighetene deres. Brukere kan i tillegg få en
-- tilpasset rettighetsliste som overstyrer rollen.

CREATE TABLE "Role" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "Role_label_key" ON "Role"("label");
CREATE INDEX "Role_isSystem_idx" ON "Role"("isSystem");

INSERT INTO "Role" (
    "key",
    "label",
    "description",
    "permissions",
    "isSystem",
    "createdAt",
    "updatedAt"
)
VALUES
    (
        'ADMIN',
        'Administrator',
        'Full tilgang, inkludert sletting, brukeradministrasjon og aktivitetslogg.',
        ARRAY[
            'workorders.view',
            'workorders.create',
            'workorders.update',
            'workorders.edit',
            'workorders.assign',
            'customers.view',
            'customers.manage',
            'equipment.view',
            'equipment.manage',
            'reports.view',
            'reports.write',
            'documents.view',
            'documents.manage',
            'templates.view',
            'templates.manage',
            'users.view',
            'users.manage',
            'settings.manage',
            'audit.view'
        ]::TEXT[],
        true,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'OFFICE',
        'Kontor',
        'Kunder, utstyr, oppdrag, maler og ansatte i egen avdeling.',
        ARRAY[
            'workorders.view',
            'workorders.create',
            'workorders.update',
            'workorders.edit',
            'workorders.assign',
            'customers.view',
            'customers.manage',
            'equipment.view',
            'equipment.manage',
            'reports.view',
            'reports.write',
            'documents.view',
            'documents.manage',
            'templates.view',
            'templates.manage',
            'users.view',
            'users.manage',
            'settings.manage'
        ]::TEXT[],
        true,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'TECHNICIAN',
        'Montør',
        'Feltportal med oppdrag, kunder, utstyr, rapporter og dokumenter i egen avdeling.',
        ARRAY[
            'workorders.view',
            'workorders.create',
            'workorders.update',
            'customers.view',
            'equipment.view',
            'reports.view',
            'reports.write',
            'documents.view',
            'templates.view'
        ]::TEXT[],
        true,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'USER',
        'Standard',
        'Ingen tilgang som standard. Rettigheter kan gis per bruker.',
        ARRAY[]::TEXT[],
        true,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    ),
    (
        'CUSTOMER',
        'Kundeportal',
        'Kundeportalbruker. Ser bare egen kundedata, uavhengig av interne rettigheter.',
        ARRAY[]::TEXT[],
        true,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    );

-- Ukjente roller fra eldre data skal ikke stoppe fremmednøkkelen.
UPDATE "User"
SET "role" = 'USER'
WHERE "role" NOT IN ('ADMIN', 'OFFICE', 'TECHNICIAN', 'USER', 'CUSTOMER');

ALTER TABLE "User" ADD COLUMN "permissionsCustomized" BOOLEAN NOT NULL DEFAULT false;

-- Eldre «ekstra rettigheter» ble lagt oppå rollens rettigheter. Gjør dem om til
-- en full, tilpasset liste slik at brukerne beholder nøyaktig samme tilgang.
UPDATE "User" u
SET
    "permissionsCustomized" = true,
    "permissions" = ARRAY(
        SELECT DISTINCT p
        FROM unnest(
            (
                CASE u."role"
                    WHEN 'ADMIN' THEN ARRAY[
                        'workorders.view',
                        'workorders.create',
                        'workorders.update',
                        'workorders.edit',
                        'workorders.assign',
                        'customers.view',
                        'customers.manage',
                        'equipment.view',
                        'equipment.manage',
                        'reports.view',
                        'reports.write',
                        'documents.view',
                        'documents.manage',
                        'templates.view',
                        'templates.manage',
                        'users.view',
                        'users.manage',
                        'settings.manage',
                        'audit.view'
                    ]::TEXT[]
                    WHEN 'OFFICE' THEN ARRAY[
                        'workorders.view',
                        'workorders.create',
                        'workorders.update',
                        'workorders.edit',
                        'workorders.assign',
                        'customers.view',
                        'customers.manage',
                        'equipment.view',
                        'equipment.manage',
                        'reports.view',
                        'reports.write',
                        'documents.view',
                        'documents.manage',
                        'templates.view',
                        'templates.manage',
                        'users.view',
                        'users.manage',
                        'settings.manage'
                    ]::TEXT[]
                    WHEN 'TECHNICIAN' THEN ARRAY[
                        'workorders.view',
                        'workorders.create',
                        'workorders.update',
                        'customers.view',
                        'equipment.view',
                        'reports.view',
                        'reports.write',
                        'documents.view',
                        'templates.view'
                    ]::TEXT[]
                    ELSE ARRAY[]::TEXT[]
                END
                || u."permissions"
            )
        ) AS p
    )
WHERE cardinality(u."permissions") > 0;

ALTER TABLE "User"
    ADD CONSTRAINT "User_role_fkey"
    FOREIGN KEY ("role") REFERENCES "Role"("key")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "User_role_idx" ON "User"("role");
