-- Provisionerer separate migrasjons- og runtime-roller for FSM-plattformen.
--
-- Kjøres av scripts/provision-db-roles.sh, som sender inn variablene under.
-- Skriptet er idempotent: det oppretter rollene hvis de mangler, oppdaterer
-- passord og rettigheter, og kan kjøres på nytt etter nye migrasjoner.
--
-- Kjøres som Postgres-superbruker i appdatabasen. Migrasjonene må være kjørt
-- først, slik at tabellene finnes.

\set ON_ERROR_STOP on
\getenv migration_password FSM_MIGRATION_PASSWORD
\getenv runtime_password FSM_RUNTIME_PASSWORD

\if :{?migration_password}
\else
  \echo '✖ FSM_MIGRATION_PASSWORD mangler'
  \quit 1
\endif
\if :{?runtime_password}
\else
  \echo '✖ FSM_RUNTIME_PASSWORD mangler'
  \quit 1
\endif

-- Migrasjonsrollen eier skjemaet og kjører DDL. Den er ikke superbruker.
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'migration_role', :'migration_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migration_role')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'migration_role', :'migration_password'
)
\gexec

-- Runtime-rollen skal bare kunne DML, aldri endre skjema.
SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'runtime_role', :'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role')
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'runtime_role', :'runtime_password'
)
\gexec

-- Eierskap flyttes til migrasjonsrollen. På en fersk database eier
-- superbrukeren databasen og public-skjemaet fra før.
SELECT format('ALTER DATABASE %I OWNER TO %I', :'database_name', :'migration_role')
\gexec
SELECT format('ALTER SCHEMA public OWNER TO %I', :'migration_role')
\gexec

-- Eksisterende installasjon: valgfri overføring av objekter fra den gamle
-- eieren (typisk admin/postgres). Bare gjort når REASSIGN_OWNER er satt
-- eksplisitt, fordi det flytter eierskap for alle objekter i databasen.
SELECT format('REASSIGN OWNED BY %I TO %I', :'reassign_owner', :'migration_role')
WHERE :'reassign_owner' <> ''
  AND :'reassign_owner' <> :'migration_role'
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'reassign_owner')
\gexec

-- Ingen skal kunne lage objekter i public uten å eie skjemaet.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('REVOKE CREATE ON SCHEMA public FROM %I', :'runtime_role')
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'runtime_role')
\gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_role')
\gexec

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"runtime_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime_role";

-- Nye tabeller/sekvenser som migrasjonsrollen lager senere får samme rettigheter.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role";

-- Revisjonssporet skal ikke kunne endres eller slettes av approllen. Appen
-- trenger bare INSERT og SELECT. Migrasjonsrollen beholder full kontroll.
SELECT format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE %I FROM %I', 'AuditLog', :'runtime_role')
WHERE to_regclass('public."AuditLog"') IS NOT NULL
\gexec

-- Prisma-migrasjonstabellen er migrasjonsrollens domene.
SELECT format('REVOKE ALL ON TABLE %I FROM %I', '_prisma_migrations', :'runtime_role')
WHERE to_regclass('public."_prisma_migrations"') IS NOT NULL
\gexec
