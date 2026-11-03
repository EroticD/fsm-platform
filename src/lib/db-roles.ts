/**
 * Minste privilegium for databaseforbindelsen appen bruker i produksjon.
 *
 * Migrasjonene skal kjøre som en egen DDL-rolle (fsm_migrator), mens appen
 * bruker en DML-rolle (fsm_app). Denne hjelperen gjør readiness i stand til å
 * oppdage at noen fortsatt har falt tilbake til superbrukeren.
 */

export type DatabaseRoleInfo = {
  currentUser: string;
  superuser: boolean;
  createDb: boolean;
  createRole: boolean;
  schemaCreate: boolean;
};

/** Rollen kan endre skjema eller opprette nye databaser/roller. */
export function roleCanDdl(role: DatabaseRoleInfo): boolean {
  return (
    role.superuser ||
    role.createDb ||
    role.createRole ||
    role.schemaCreate
  );
}

/**
 * Produksjon skal være fail-closed: en DDL-kapabel runtime-rolle gjør
 * readiness 503 med mindre operatøren bevisst har valgt det bort.
 */
export function runtimeRoleIsUnsafe(
  role: DatabaseRoleInfo | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!role) return false;
  if (env.NODE_ENV !== "production") return false;
  if (env.ALLOW_DB_DDL_ROLE === "true") return false;
  return roleCanDdl(role);
}
