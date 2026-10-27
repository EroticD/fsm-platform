-- Fyll kilde på eksisterende varsler der lenken peker på et oppdrag.
UPDATE "Notification" AS n
SET "sourceLabel" =
  'Oppdrag: ' || w."title" ||
  CASE WHEN c."name" IS NULL THEN '' ELSE ' · ' || c."name" END
FROM "WorkOrder" AS w
LEFT JOIN "Customer" AS c ON c."id" = w."customerId"
WHERE n."sourceLabel" IS NULL
  AND n."href" IN ('/oppdrag/' || w."id", '/mine-oppdrag/' || w."id", '/rapporter/' || w."id");

-- Fyll kilde der varselet peker direkte på en kunde.
UPDATE "Notification" AS n
SET "sourceLabel" = 'Kunde: ' || c."name"
FROM "Customer" AS c
WHERE n."sourceLabel" IS NULL
  AND n."href" = '/kunder/' || c."id";
