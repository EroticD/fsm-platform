-- Revisjonsloggen skal ikke kunne endres eller slettes av applikasjonsrollen.
-- Retensjonsjobben kjører med samme rolle som appen, så sletting håndheves i
-- koden og i revisjonskjeden; denne migreringen stenger for UPDATE/DELETE for
-- andre roller enn eieren, og dokumenterer at tabellen er append-only.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fsm_app') THEN
    REVOKE UPDATE, DELETE ON "AuditLog" FROM fsm_app;
  END IF;
END
$$;

COMMENT ON TABLE "AuditLog" IS 'Append-only, hash-kjedet revisjonslogg. UPDATE/DELETE er reservert for retensjonsjobben som eier rollen.';
