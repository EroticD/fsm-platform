// i18n-ignore-file: SCIM-feil og revisjonshandlinger er stabile data.
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { cleanEmail } from "@/lib/sanitize";
import { logger } from "@/lib/logger";
import {
  applyScimPatch,
  parseScimFilter,
  parseScimPatch,
  parseScimUser,
  scimDisplayName,
  scimFilterWhere,
  scimInputFromUser,
  scimListResponse,
  scimUserResource,
  scimUserName,
  type ScimUserInput,
} from "@/lib/scim";
import { parseGroupRoleMap } from "@/lib/sso";
import type { ScimTokenActor } from "@/server/scim-tokens";

/**
 * SCIM 2.0-provisjonering av brukere.
 *
 * Tjenesten er bevisst konservativ:
 *  - passord settes aldri, og ukjente passordfelt ignoreres
 *  - en eksisterende kundeportalbruker kan ikke endres via SCIM
 *  - ADMIN krever SCIM_ALLOW_ADMIN=true i tillegg til eksplisitt mapping
 *  - standardrolle er USER, og nye brukere er inaktive med mindre active=true
 *  - e-postdomener kan begrenses med SCIM_ALLOWED_EMAIL_DOMAINS
 *  - sletting er myk deaktivering som øker sessionVersion
 */

export type ScimFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 500;
  detail: string;
  scimType?: string;
};

export type ScimResult<T> = { ok: true; data: T } | ScimFailure;

function fail(
  status: ScimFailure["status"],
  detail: string,
  scimType?: string,
): ScimFailure {
  return { ok: false, status, detail, scimType };
}

export type ScimUserRecord = {
  id: string;
  email: string | null;
  name: string | null;
  scimExternalId: string | null;
  isActive: boolean;
  role: string;
  departmentId: string | null;
  department: { id: string; name: string } | null;
};

export const SCIM_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  scimExternalId: true,
  isActive: true,
  role: true,
  departmentId: true,
  department: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

type ScimUserRow = Prisma.UserGetPayload<{ select: typeof SCIM_USER_SELECT }>;

function toRecord(row: ScimUserRow): ScimUserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    scimExternalId: row.scimExternalId,
    isActive: row.isActive,
    role: row.role,
    departmentId: row.departmentId,
    department: row.department ?? null,
  };
}

function envList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

function enabled(value: string | undefined): boolean {
  return ["true", "1", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export type ScimConfig = {
  allowedEmailDomains: string[];
  defaultRole: string;
  defaultDepartment: string | null;
  allowAdmin: boolean;
  groupRoleMap: Record<string, string>;
};

export function readScimConfig(
  env: Record<string, string | undefined> = process.env,
): ScimConfig {
  return {
    allowedEmailDomains: envList(env.SCIM_ALLOWED_EMAIL_DOMAINS),
    defaultRole: (env.SCIM_DEFAULT_ROLE ?? "USER").trim().toUpperCase() || "USER",
    defaultDepartment: env.SCIM_DEFAULT_DEPARTMENT?.trim() || null,
    allowAdmin: enabled(env.SCIM_ALLOW_ADMIN),
    groupRoleMap: parseGroupRoleMap(env.SCIM_GROUP_ROLE_MAP).map,
  };
}

export function scimEmailDomainAllowed(
  email: string,
  allowedDomains: readonly string[],
): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = cleanEmail(email).split("@")[1] ?? "";
  return Boolean(domain) && allowedDomains.includes(domain);
}

function scimActor(actor: ScimTokenActor) {
  return {
    id: actor.createdById ?? `scim:${actor.tokenId}`,
    name: "SCIM",
    email: null,
    departmentId: null,
  };
}

async function roleExists(role: string): Promise<boolean> {
  if (!role || role === "CUSTOMER") return false;
  const row = await prisma.role.findUnique({
    where: { key: role },
    select: { key: true },
  });
  return Boolean(row);
}

async function resolveDepartment(
  value: string | null,
): Promise<{ ok: true; id: string | null } | { ok: false }> {
  if (!value) return { ok: true, id: null };
  const department = await prisma.department.findFirst({
    where: {
      OR: [{ id: value }, { name: { equals: value, mode: "insensitive" } }],
    },
    select: { id: true },
  });
  return department ? { ok: true, id: department.id } : { ok: false };
}

/**
 * Rollen SCIM ber om. Grupper må være eksplisitt mappet; direkte rollenavn
 * godtas bare når rollen finnes. Flere ulike roller avvises i stedet for å
 * velge den mest privilegerte.
 */
async function resolveRole(
  input: ScimUserInput,
  config: ScimConfig,
  fallback: string | null,
): Promise<{ ok: true; role: string | null } | ScimFailure> {
  const requested = new Set<string>();
  for (const group of input.groups) {
    const mapped = config.groupRoleMap[group];
    if (mapped) requested.add(mapped.toUpperCase());
  }
  for (const role of input.roles) {
    const mapped = config.groupRoleMap[role];
    requested.add((mapped ?? role).toUpperCase());
  }

  if (requested.size > 1) {
    return fail(
      400,
      "Brukeren peker på flere ulike roller. Rydd i gruppemappingen.",
      "invalidValue",
    );
  }
  const role = Array.from(requested)[0] ?? fallback ?? null;
  if (!role) return { ok: true, role: null };

  if (role === "CUSTOMER") {
    return fail(400, "SCIM kan ikke tildele kundeportalrollen.", "invalidValue");
  }
  if (role === "ADMIN" && !config.allowAdmin) {
    return fail(
      400,
      "ADMIN via SCIM krever SCIM_ALLOW_ADMIN=true og en eksplisitt mapping.",
      "invalidValue",
    );
  }
  if (!(await roleExists(role))) {
    return fail(400, `Rollen «${role}» finnes ikke.`, "invalidValue");
  }
  return { ok: true, role };
}

async function assertUnique(
  email: string,
  externalId: string | null,
  excludeUserId?: string,
): Promise<ScimFailure | null> {
  const conflict = await prisma.user.findFirst({
    where: {
      AND: [
        { OR: [{ email }, ...(externalId ? [{ scimExternalId: externalId }] : [])] },
        ...(excludeUserId ? [{ id: { not: excludeUserId } }] : []),
      ],
    },
    select: { id: true, email: true, scimExternalId: true },
  });
  if (!conflict) return null;
  if (externalId && conflict.scimExternalId === externalId) {
    return fail(409, "externalId er allerede i bruk.", "uniqueness");
  }
  return fail(409, "E-postadressen er allerede i bruk.", "uniqueness");
}

function isProtected(user: { role: string; customerId?: string | null }): boolean {
  return user.role === "CUSTOMER" || Boolean(user.customerId);
}

export async function listScimUsers(
  query: { filter: string | null; startIndex: number; count: number },
  baseUrl = "",
): Promise<
  ScimResult<{ totalResults: number; resources: Record<string, unknown>[] }>
> {
  const parsed = parseScimFilter(query.filter);
  if (!parsed.ok) return fail(400, parsed.detail, parsed.scimType);
  const where = scimFilterWhere(parsed.data);
  if (!where.ok) return fail(400, where.detail, where.scimType);

  try {
    const [total, rows] = await Promise.all([
      prisma.user.count({ where: where.data }),
      query.count === 0
        ? Promise.resolve([] as ScimUserRow[])
        : prisma.user.findMany({
            where: where.data,
            select: SCIM_USER_SELECT,
            orderBy: [{ email: "asc" }, { id: "asc" }],
            skip: query.startIndex - 1,
            take: query.count,
          }),
    ]);
    return {
      ok: true,
      data: {
        totalResults: total,
        resources: rows.map((row) => scimUserResource(toRecord(row), baseUrl)),
      },
    };
  } catch (error) {
    logger.error("SCIM: kunne ikke liste brukere", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail(500, "Kunne ikke hente brukere.");
  }
}

/** Brukes av ruten for ListResponse med riktig startIndex. */
export function scimUsersListBody(
  result: { totalResults: number; resources: Record<string, unknown>[] },
  startIndex: number,
): Record<string, unknown> {
  return scimListResponse(result.resources, result.totalResults, startIndex);
}

export async function getScimUser(
  id: string,
  baseUrl = "",
): Promise<ScimResult<Record<string, unknown>>> {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: SCIM_USER_SELECT,
    });
    if (!user) return fail(404, "Brukeren finnes ikke.");
    return { ok: true, data: scimUserResource(toRecord(user), baseUrl) };
  } catch {
    return fail(400, "Kunne ikke hente brukeren.");
  }
}

export async function createScimUser(
  body: unknown,
  actor: ScimTokenActor,
  env: Record<string, string | undefined> = process.env,
): Promise<ScimResult<Record<string, unknown>>> {
  const config = readScimConfig(env);
  const parsed = parseScimUser(body, { requireUserName: true });
  if (!parsed.ok) return fail(400, parsed.detail, parsed.scimType);
  const input = parsed.data;
  const email = scimUserName(input);

  if (!scimEmailDomainAllowed(email, config.allowedEmailDomains)) {
    return fail(
      400,
      "E-postdomenet er ikke tillatt for SCIM-provisjonering.",
      "invalidValue",
    );
  }

  const role = await resolveRole(input, config, config.defaultRole);
  if (!role.ok) return role;

  const department = await resolveDepartment(
    input.department ?? config.defaultDepartment,
  );
  if (!department.ok) {
    return fail(400, "Avdelingen finnes ikke.", "invalidValue");
  }

  const unique = await assertUnique(email, input.externalId);
  if (unique) return unique;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: scimDisplayName(input),
          role: role.role ?? config.defaultRole,
          departmentId: department.id,
          // SCIM må eksplisitt sende active=true for at kontoen skal kunne
          // logge inn. Uten feltet blir den inaktiv, som er tryggest.
          isActive: input.active === true,
          emailVerified: new Date(),
          scimExternalId: input.externalId,
          // Bevisst ingen password: SCIM skal aldri opprette lokal pålogging.
        },
        select: SCIM_USER_SELECT,
      });
      await audit(tx, {
        entityType: "User",
        entityId: user.id,
        action: "Opprettet bruker via SCIM",
        actor: scimActor(actor),
        metadata: {
          source: "scim",
          scimTokenId: actor.tokenId,
          role: user.role,
          active: user.isActive,
          externalId: user.scimExternalId,
        },
      });
      return user;
    });
    return { ok: true, data: scimUserResource(toRecord(created)) };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return fail(409, "E-postadressen er allerede i bruk.", "uniqueness");
    }
    logger.error("SCIM: kunne ikke opprette bruker", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail(400, "Kunne ikke opprette brukeren.");
  }
}

type UpdateOptions = {
  /** PUT uten enterprise-extension skal ikke slette en eksisterende avdeling. */
  preserveMissingDepartment: boolean;
};

export async function updateScimUser(
  id: string,
  body: unknown,
  actor: ScimTokenActor,
  options: UpdateOptions = { preserveMissingDepartment: true },
  env: Record<string, string | undefined> = process.env,
): Promise<ScimResult<Record<string, unknown>>> {
  const config = readScimConfig(env);
  const parsed = parseScimUser(body, { requireUserName: true });
  if (!parsed.ok) return fail(400, parsed.detail, parsed.scimType);
  return persistScimUpdate(id, parsed.data, actor, options, config);
}

export async function patchScimUser(
  id: string,
  body: unknown,
  actor: ScimTokenActor,
  env: Record<string, string | undefined> = process.env,
): Promise<ScimResult<Record<string, unknown>>> {
  const config = readScimConfig(env);
  const operations = parseScimPatch(body);
  if (!operations.ok) return fail(400, operations.detail, operations.scimType);

  let existing: ScimUserRow | null;
  try {
    existing = await prisma.user.findUnique({
      where: { id },
      select: SCIM_USER_SELECT,
    });
  } catch {
    return fail(400, "Kunne ikke hente brukeren.");
  }
  if (!existing) return fail(404, "Brukeren finnes ikke.");
  if (isProtected(existing)) {
    return fail(403, "Kundeportalbrukere kan ikke endres via SCIM.");
  }

  const applied = applyScimPatch(scimInputFromUser(toRecord(existing)), operations.data);
  if (!applied.ok) return fail(400, applied.detail, applied.scimType);
  return persistScimUpdate(
    id,
    applied.data,
    actor,
    { preserveMissingDepartment: false },
    config,
    existing,
  );
}

async function persistScimUpdate(
  id: string,
  input: ScimUserInput,
  actor: ScimTokenActor,
  options: UpdateOptions,
  config: ScimConfig,
  knownExisting?: ScimUserRow,
): Promise<ScimResult<Record<string, unknown>>> {
  let existing: ScimUserRow | null;
  try {
    existing =
      knownExisting ??
      (await prisma.user.findUnique({
        where: { id },
        select: SCIM_USER_SELECT,
      }));
  } catch {
    return fail(400, "Kunne ikke hente brukeren.");
  }
  if (!existing) return fail(404, "Brukeren finnes ikke.");
  if (isProtected(existing)) {
    return fail(403, "Kundeportalbrukere kan ikke endres via SCIM.");
  }

  const email = scimUserName(input);
  if (!scimEmailDomainAllowed(email, config.allowedEmailDomains)) {
    return fail(
      400,
      "E-postdomenet er ikke tillatt for SCIM-provisjonering.",
      "invalidValue",
    );
  }

  const role = await resolveRole(input, config, null);
  if (!role.ok) return role;

  const department = input.department
    ? await resolveDepartment(input.department)
    : { ok: true as const, id: options.preserveMissingDepartment ? existing.departmentId : null };
  if (!department.ok) {
    return fail(400, "Avdelingen finnes ikke.", "invalidValue");
  }

  const unique = await assertUnique(email, input.externalId, existing.id);
  if (unique) return unique;

  const nextRole = role.role ?? existing.role;
  const nextActive = input.active ?? existing.isActive;
  const nextName = scimDisplayName(input) ?? existing.name;
  const nextExternalId = input.externalId;
  const nextDepartmentId = department.id;

  const changedFields: string[] = [];
  if (email !== existing.email) changedFields.push("emails");
  if (nextRole !== existing.role) changedFields.push("roles");
  if (nextActive !== existing.isActive) changedFields.push("active");
  if (nextDepartmentId !== existing.departmentId) changedFields.push("department");
  if (nextExternalId !== existing.scimExternalId) changedFields.push("externalId");
  if (nextName !== existing.name) changedFields.push("name");

  if (changedFields.length === 0) {
    return { ok: true, data: scimUserResource(toRecord(existing)) };
  }

  // Roller, avdeling, e-post og aktiv status påvirker tilgangen og skal
  // ugyldiggjøre eksisterende økter med en gang.
  const invalidatesSession = changedFields.some((field) =>
    ["emails", "roles", "active", "department"].includes(field),
  );

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: {
          email,
          name: nextName,
          role: nextRole,
          departmentId: nextDepartmentId,
          isActive: nextActive,
          scimExternalId: nextExternalId,
          ...(invalidatesSession ? { sessionVersion: { increment: 1 } } : {}),
        },
        select: SCIM_USER_SELECT,
      });
      await audit(tx, {
        entityType: "User",
        entityId: user.id,
        action: "Oppdaterte bruker via SCIM",
        actor: scimActor(actor),
        metadata: {
          source: "scim",
          scimTokenId: actor.tokenId,
          fields: changedFields,
          role: user.role,
          active: user.isActive,
        },
      });
      return user;
    });
    return { ok: true, data: scimUserResource(toRecord(updated)) };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return fail(409, "E-postadressen er allerede i bruk.", "uniqueness");
    }
    logger.error("SCIM: kunne ikke oppdatere bruker", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail(400, "Kunne ikke oppdatere brukeren.");
  }
}

/** DELETE deaktiverer brukeren; raden og historikken beholdes. */
export async function deactivateScimUser(
  id: string,
  actor: ScimTokenActor,
): Promise<ScimResult<null>> {
  try {
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, customerId: true, isActive: true },
    });
    if (!existing) return fail(404, "Brukeren finnes ikke.");
    if (isProtected(existing)) {
      return fail(403, "Kundeportalbrukere kan ikke deaktiveres via SCIM.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          isActive: false,
          sessionVersion: { increment: 1 },
        },
        select: { id: true },
      });
      await audit(tx, {
        entityType: "User",
        entityId: id,
        action: "Deaktiverte bruker via SCIM",
        actor: scimActor(actor),
        metadata: { source: "scim", scimTokenId: actor.tokenId },
      });
    });
    return { ok: true, data: null };
  } catch (error) {
    logger.error("SCIM: kunne ikke deaktivere bruker", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail(400, "Kunne ikke deaktivere brukeren.");
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/** Brukes av tester og ruter for å bygge ListResponse uten ekstra mapping. */
export function scimUserListResponse(
  resources: Record<string, unknown>[],
  totalResults: number,
  startIndex: number,
): Record<string, unknown> {
  return scimListResponse(resources, totalResults, startIndex);
}
