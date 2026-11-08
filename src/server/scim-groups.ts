// i18n-ignore-file: SCIM-feil og revisjonshandlinger er stabile data.
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import {
  parseScimFilter,
  type ScimParseResult,
} from "@/lib/scim";
import {
  applyScimGroupPatch,
  parseScimGroup,
  parseScimGroupPatch,
  scimGroupFilterWhere,
  scimGroupResource,
  type ScimGroupInput,
  type ScimGroupRow,
} from "@/lib/scim-groups";
import type { ScimTokenActor } from "@/server/scim-tokens";
import { readScimConfig, type ScimConfig } from "@/server/scim-users";

/**
 * SCIM 2.0-grupper.
 *
 * Gruppemedlemskap påvirker bare rolle/avdeling når gruppenavnet finnes i
 * `SCIM_GROUP_ROLE_MAP` eller `SCIM_GROUP_DEPARTMENT_MAP`. Uten mapping skjer
 * ingenting. ADMIN krever i tillegg `SCIM_ALLOW_ADMIN=true`, så en ny gruppe
 * kan aldri gi administrator av seg selv.
 */

export type ScimGroupFailure = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 500;
  detail: string;
  scimType?: string;
};

export type ScimGroupResult<T> = { ok: true; data: T } | ScimGroupFailure;

function fail(
  status: ScimGroupFailure["status"],
  detail: string,
  scimType?: string,
): ScimGroupFailure {
  return { ok: false, status, detail, scimType };
}

export const SCIM_GROUP_SELECT = {
  id: true,
  displayName: true,
  externalId: true,
  members: {
    select: {
      userId: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.ScimGroupSelect;

type ScimGroupDbRow = Prisma.ScimGroupGetPayload<{
  select: typeof SCIM_GROUP_SELECT;
}>;

function toRecord(row: ScimGroupDbRow): ScimGroupRow {
  return {
    id: row.id,
    displayName: row.displayName,
    externalId: row.externalId,
    members: row.members,
  };
}

function scimActor(actor: ScimTokenActor) {
  return {
    id: actor.createdById ?? `scim:${actor.tokenId}`,
    name: "SCIM",
    email: null,
    departmentId: null,
  };
}

async function assertUnique(
  displayName: string,
  externalId: string | null,
  excludeId?: string,
): Promise<ScimGroupFailure | null> {
  const conflict = await prisma.scimGroup.findFirst({
    where: {
      AND: [
        {
          OR: [
            { displayName: { equals: displayName, mode: "insensitive" } },
            ...(externalId ? [{ externalId }] : []),
          ],
        },
        ...(excludeId ? [{ id: { not: excludeId } }] : []),
      ],
    },
    select: { id: true, displayName: true, externalId: true },
  });
  if (!conflict) return null;
  if (externalId && conflict.externalId === externalId) {
    return fail(409, "externalId er allerede i bruk.", "uniqueness");
  }
  return fail(409, "Gruppenavnet er allerede i bruk.", "uniqueness");
}

async function resolveMembers(
  ids: readonly string[],
): Promise<{ ok: true; ids: string[] } | ScimGroupFailure> {
  if (ids.length === 0) return { ok: true, ids: [] };
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] }, role: { not: "CUSTOMER" } },
    select: { id: true },
  });
  if (users.length !== ids.length) {
    return fail(
      400,
      "En eller flere medlemmer finnes ikke eller er kundeportalbrukere.",
      "invalidValue",
    );
  }
  return { ok: true, ids: users.map((user) => user.id) };
}

type GroupTx = Prisma.TransactionClient;

async function roleExists(tx: GroupTx, role: string): Promise<boolean> {
  if (!role || role === "CUSTOMER") return false;
  const row = await tx.role.findUnique({
    where: { key: role },
    select: { key: true },
  });
  return Boolean(row);
}

async function resolveDepartmentId(
  tx: GroupTx,
  name: string,
): Promise<string | null> {
  const department = await tx.department.findFirst({
    where: {
      OR: [{ id: name }, { name: { equals: name, mode: "insensitive" } }],
    },
    select: { id: true },
  });
  return department?.id ?? null;
}

/**
 * Bruker SCIM-gruppenes medlemskap til å oppdatere rolle/avdeling for berørte
 * brukere. Konflikt eller ugyldig mapping gir ingen endring – bare revisjon.
 */
async function syncGroupEffects(
  tx: GroupTx,
  userIds: readonly string[],
  actor: ScimTokenActor,
  config: ScimConfig,
): Promise<void> {
  for (const userId of Array.from(new Set(userIds))) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        customerId: true,
        departmentId: true,
        scimGroups: {
          select: {
            group: { select: { displayName: true, externalId: true } },
          },
        },
      },
    });
    if (!user || !user.isActive) continue;
    if (user.customerId || user.role === "CUSTOMER") continue;

    const groupNames = user.scimGroups.flatMap((membership) =>
      [
        membership.group.displayName,
        membership.group.externalId,
      ].filter((name): name is string => Boolean(name)),
    );

    const roles = Array.from(
      new Set(
        groupNames
          .map((name) => config.groupRoleMap[name])
          .filter((role): role is string => Boolean(role))
          .map((role) => role.toUpperCase()),
      ),
    );
    const departments = Array.from(
      new Set(
        groupNames
          .map((name) => config.groupDepartmentMap[name])
          .filter((name): name is string => Boolean(name)),
      ),
    );

    let nextRole: string | null = null;
    if (roles.length === 1) {
      const role = roles[0];
      if (role === "ADMIN" && !config.allowAdmin) {
        await audit(tx, {
          entityType: "ScimGroup",
          entityId: user.id,
          action: "SCIM: ADMIN-gruppe ignorert (SCIM_ALLOW_ADMIN er av)",
          actor: scimActor(actor),
          metadata: { source: "scim", groupRole: role, groups: groupNames },
        });
      } else if (await roleExists(tx, role)) {
        nextRole = role;
      }
    } else if (roles.length > 1) {
      await audit(tx, {
        entityType: "ScimGroup",
        entityId: user.id,
        action: "SCIM: gruppekonflikt for rolle – ingen endring",
        actor: scimActor(actor),
        metadata: { source: "scim", roles, groups: groupNames },
      });
    }

    let nextDepartmentId: string | null = null;
    if (departments.length === 1) {
      nextDepartmentId = await resolveDepartmentId(tx, departments[0]);
    } else if (departments.length > 1) {
      await audit(tx, {
        entityType: "ScimGroup",
        entityId: user.id,
        action: "SCIM: gruppekonflikt for avdeling – ingen endring",
        actor: scimActor(actor),
        metadata: { source: "scim", departments, groups: groupNames },
      });
    }

    const roleChanged = Boolean(nextRole && nextRole !== user.role);
    const departmentChanged = Boolean(
      nextDepartmentId && nextDepartmentId !== user.departmentId,
    );
    if (!roleChanged && !departmentChanged) continue;

    await tx.user.update({
      where: { id: user.id },
      data: {
        ...(roleChanged ? { role: nextRole! } : {}),
        ...(departmentChanged ? { departmentId: nextDepartmentId! } : {}),
        sessionVersion: { increment: 1 },
      },
      select: { id: true },
    });
    await audit(tx, {
      entityType: "User",
      entityId: user.id,
      action: "SCIM: tilgang oppdatert fra gruppemedlemskap",
      actor: scimActor(actor),
      metadata: {
        source: "scim",
        previousRole: user.role,
        role: nextRole ?? user.role,
        previousDepartmentId: user.departmentId,
        departmentId: nextDepartmentId ?? user.departmentId,
        groups: groupNames,
      },
    });
  }
}

export async function listScimGroups(
  query: { filter: string | null; startIndex: number; count: number },
  baseUrl = "",
): Promise<
  ScimGroupResult<{ totalResults: number; resources: Record<string, unknown>[] }>
> {
  const parsed = parseScimFilter(query.filter);
  if (!parsed.ok) return fail(400, parsed.detail, parsed.scimType);
  const where: ScimParseResult<Prisma.ScimGroupWhereInput> =
    scimGroupFilterWhere(parsed.data);
  if (!where.ok) return fail(400, where.detail, where.scimType);

  try {
    const [total, rows] = await Promise.all([
      prisma.scimGroup.count({ where: where.data }),
      query.count === 0
        ? Promise.resolve([] as ScimGroupDbRow[])
        : prisma.scimGroup.findMany({
            where: where.data,
            select: SCIM_GROUP_SELECT,
            orderBy: [{ displayName: "asc" }, { id: "asc" }],
            skip: query.startIndex - 1,
            take: query.count,
          }),
    ]);
    return {
      ok: true,
      data: {
        totalResults: total,
        resources: rows.map((row) => scimGroupResource(toRecord(row), baseUrl)),
      },
    };
  } catch (error) {
    logger.error("SCIM: kunne ikke liste grupper", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail(500, "Kunne ikke hente grupper.");
  }
}

export async function getScimGroup(
  id: string,
  baseUrl = "",
): Promise<ScimGroupResult<Record<string, unknown>>> {
  try {
    const group = await prisma.scimGroup.findUnique({
      where: { id },
      select: SCIM_GROUP_SELECT,
    });
    if (!group) return fail(404, "Gruppen finnes ikke.");
    return { ok: true, data: scimGroupResource(toRecord(group), baseUrl) };
  } catch {
    return fail(400, "Kunne ikke hente gruppen.");
  }
}

export async function createScimGroup(
  body: unknown,
  actor: ScimTokenActor,
  env: Record<string, string | undefined> = process.env,
): Promise<ScimGroupResult<Record<string, unknown>>> {
  const config = readScimConfig(env);
  const parsed = parseScimGroup(body);
  if (!parsed.ok) return fail(400, parsed.detail, parsed.scimType);
  const unique = await assertUnique(
    parsed.data.displayName,
    parsed.data.externalId,
  );
  if (unique) return unique;
  const members = await resolveMembers(parsed.data.memberIds);
  if (!members.ok) return members;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const group = await tx.scimGroup.create({
        data: {
          displayName: parsed.data.displayName,
          externalId: parsed.data.externalId,
          createdById: actor.createdById,
          members: {
            create: members.ids.map((userId) => ({ userId })),
          },
        },
        select: SCIM_GROUP_SELECT,
      });
      await audit(tx, {
        entityType: "ScimGroup",
        entityId: group.id,
        action: "Opprettet gruppe via SCIM",
        actor: scimActor(actor),
        metadata: {
          source: "scim",
          scimTokenId: actor.tokenId,
          displayName: group.displayName,
          externalId: group.externalId,
          members: members.ids.length,
        },
      });
      await syncGroupEffects(tx, members.ids, actor, config);
      return group;
    });
    return { ok: true, data: scimGroupResource(toRecord(created)) };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return fail(409, "Gruppen finnes allerede.", "uniqueness");
    }
    logger.error("SCIM: kunne ikke opprette gruppe", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail(400, "Kunne ikke opprette gruppen.");
  }
}

export async function updateScimGroup(
  id: string,
  body: unknown,
  actor: ScimTokenActor,
  env: Record<string, string | undefined> = process.env,
): Promise<ScimGroupResult<Record<string, unknown>>> {
  const config = readScimConfig(env);
  const parsed = parseScimGroup(body);
  if (!parsed.ok) return fail(400, parsed.detail, parsed.scimType);
  return persistGroupUpdate(id, parsed.data, actor, config);
}

export async function patchScimGroup(
  id: string,
  body: unknown,
  actor: ScimTokenActor,
  env: Record<string, string | undefined> = process.env,
): Promise<ScimGroupResult<Record<string, unknown>>> {
  const config = readScimConfig(env);
  const operations = parseScimGroupPatch(body);
  if (!operations.ok) return fail(400, operations.detail, operations.scimType);

  try {
    const existing = await prisma.scimGroup.findUnique({
      where: { id },
      select: SCIM_GROUP_SELECT,
    });
    if (!existing) return fail(404, "Gruppen finnes ikke.");

    const base: ScimGroupInput = {
      displayName: existing.displayName,
      externalId: existing.externalId,
      memberIds: existing.members.map((member) => member.userId),
    };
    const applied = applyScimGroupPatch(base, operations.data);
    if (!applied.ok) return fail(400, applied.detail, applied.scimType);
    return persistGroupUpdate(id, applied.data, actor, config, existing);
  } catch (error) {
    logger.error("SCIM: kunne ikke endre gruppe", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail(400, "Kunne ikke endre gruppen.");
  }
}

async function persistGroupUpdate(
  id: string,
  input: ScimGroupInput,
  actor: ScimTokenActor,
  config: ScimConfig,
  knownExisting?: ScimGroupDbRow,
): Promise<ScimGroupResult<Record<string, unknown>>> {
  const existing =
    knownExisting ??
    (await prisma.scimGroup.findUnique({
      where: { id },
      select: SCIM_GROUP_SELECT,
    }));
  if (!existing) return fail(404, "Gruppen finnes ikke.");

  const unique = await assertUnique(
    input.displayName,
    input.externalId,
    existing.id,
  );
  if (unique) return unique;
  const members = await resolveMembers(input.memberIds);
  if (!members.ok) return members;

  const previousMembers = new Set(
    existing.members.map((member) => member.userId),
  );
  const nextMembers = new Set(members.ids);
  const affected = Array.from(
    new Set([...previousMembers, ...nextMembers]),
  );
  const added = members.ids.filter((userId) => !previousMembers.has(userId));
  const removed = [...previousMembers].filter(
    (userId) => !nextMembers.has(userId),
  );
  const changed =
    input.displayName !== existing.displayName ||
    input.externalId !== existing.externalId ||
    added.length > 0 ||
    removed.length > 0;
  if (!changed) {
    return { ok: true, data: scimGroupResource(toRecord(existing)) };
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.scimGroupMember.deleteMany({ where: { groupId: id } });
      const group = await tx.scimGroup.update({
        where: { id },
        data: {
          displayName: input.displayName,
          externalId: input.externalId,
          members: {
            create: members.ids.map((userId) => ({ userId })),
          },
        },
        select: SCIM_GROUP_SELECT,
      });
      await audit(tx, {
        entityType: "ScimGroup",
        entityId: group.id,
        action: "Oppdaterte gruppe via SCIM",
        actor: scimActor(actor),
        metadata: {
          source: "scim",
          scimTokenId: actor.tokenId,
          displayName: group.displayName,
          externalId: group.externalId,
          added,
          removed,
        },
      });
      await syncGroupEffects(tx, affected, actor, config);
      return group;
    });
    return { ok: true, data: scimGroupResource(toRecord(updated)) };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return fail(409, "Gruppenavnet eller externalId er allerede i bruk.", "uniqueness");
    }
    logger.error("SCIM: kunne ikke oppdatere gruppe", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail(400, "Kunne ikke oppdatere gruppen.");
  }
}

/** DELETE fjerner gruppen og medlemskapene. Brukerne og historikken beholdes. */
export async function deleteScimGroup(
  id: string,
  actor: ScimTokenActor,
): Promise<ScimGroupResult<null>> {
  const config = readScimConfig();
  try {
    const existing = await prisma.scimGroup.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        members: { select: { userId: true } },
      },
    });
    if (!existing) return fail(404, "Gruppen finnes ikke.");
    const affected = existing.members.map((member) => member.userId);

    await prisma.$transaction(async (tx) => {
      await tx.scimGroup.delete({ where: { id } });
      await audit(tx, {
        entityType: "ScimGroup",
        entityId: id,
        action: "Slettet gruppe via SCIM",
        actor: scimActor(actor),
        metadata: {
          source: "scim",
          scimTokenId: actor.tokenId,
          displayName: existing.displayName,
          removedMembers: affected.length,
        },
      });
      await syncGroupEffects(tx, affected, actor, config);
    });
    return { ok: true, data: null };
  } catch (error) {
    logger.error("SCIM: kunne ikke slette gruppe", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return fail(400, "Kunne ikke slette gruppen.");
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
