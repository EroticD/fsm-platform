// i18n-ignore-file: SCIM-gruppeskjema og feilkoder er stabile protokollverdier.
import type { Prisma } from "@prisma/client";
import {
  SCIM_PATCH_SCHEMA,
  parseScimPatch,
  type ScimFilterClause,
  type ScimParseResult,
  type ScimPatchOperation,
} from "@/lib/scim";

/**
 * SCIM 2.0-grupper (RFC 7643/7644).
 *
 * Gruppen er en speiling av IdP-ens gruppe. Medlemskap gir aldri tilgang av
 * seg selv – bare et navn som finnes i en eksplisitt rolle-/avdelingsmapping
 * påvirker en bruker. Denne modulen er DB-fri, som `scim.ts`.
 */

export const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";

export type ScimGroupInput = {
  displayName: string;
  externalId: string | null;
  /** Lokale bruker-id-er. E-post og userName godtas ikke som medlemsverdi. */
  memberIds: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function memberIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      result.push(item.trim());
      continue;
    }
    const record = asRecord(item);
    const id = stringOrNull(record?.value) ?? stringOrNull(record?.id);
    if (id) result.push(id);
  }
  return Array.from(new Set(result));
}

export function parseScimGroup(
  body: unknown,
  options: { requireDisplayName?: boolean } = {},
): ScimParseResult<ScimGroupInput> {
  const record = asRecord(body);
  if (!record) return { ok: false, detail: "Body må være et JSON-objekt." };

  const displayName = stringOrNull(record.displayName) ?? "";
  if (options.requireDisplayName !== false && !displayName) {
    return {
      ok: false,
      detail: "displayName er påkrevd.",
      scimType: "invalidValue",
    };
  }

  return {
    ok: true,
    data: {
      displayName,
      externalId: stringOrNull(record.externalId),
      memberIds: memberIds(record.members),
    },
  };
}

export type ScimGroupRow = {
  id: string;
  displayName: string;
  externalId: string | null;
  members: Array<{
    userId: string;
    user?: { id: string; name: string | null; email: string | null } | null;
  }>;
};

export function scimGroupResource(
  group: ScimGroupRow,
  baseUrl = "",
): Record<string, unknown> {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: group.id,
    externalId: group.externalId,
    displayName: group.displayName,
    members: group.members.map((member) => ({
      value: member.userId,
      display: member.user?.name ?? member.user?.email ?? member.userId,
      type: "User",
      $ref: `${baseUrl}/api/scim/v2/Users/${member.userId}`,
    })),
    meta: {
      resourceType: "Group",
      location: `${baseUrl}/api/scim/v2/Groups/${group.id}`,
    },
  };
}

/** Filter på gruppens egne attributter og direkte medlemskap. */
export function scimGroupFilterWhere(
  clauses: readonly ScimFilterClause[],
): ScimParseResult<Prisma.ScimGroupWhereInput> {
  const and: Prisma.ScimGroupWhereInput[] = [];

  for (const clause of clauses) {
    const attribute = clause.attribute.toLowerCase();
    const value = typeof clause.value === "string" ? clause.value : null;

    if (attribute === "members" || attribute === "members.value") {
      if (clause.operator === "pr") {
        and.push({ members: { some: {} } });
        continue;
      }
      if (value === null) {
        return {
          ok: false,
          detail: `${clause.attribute} krever en tekstverdi.`,
          scimType: "invalidFilter",
        };
      }
      if (clause.operator === "eq") {
        and.push({ members: { some: { userId: value } } });
      } else if (clause.operator === "ne") {
        and.push({ members: { none: { userId: value } } });
      } else {
        return {
          ok: false,
          detail: `Operatoren ${clause.operator} støttes ikke på members.`,
          scimType: "invalidFilter",
        };
      }
      continue;
    }

    if (attribute === "id") {
      if (clause.operator === "pr") continue;
      if (value === null) {
        return {
          ok: false,
          detail: "id krever en tekstverdi.",
          scimType: "invalidFilter",
        };
      }
      and.push({ id: groupStringClause(value, clause.operator) ?? value });
      continue;
    }

    if (attribute === "externalid") {
      if (clause.operator === "pr") {
        and.push({ externalId: { not: null } });
        continue;
      }
      if (value === null) {
        return {
          ok: false,
          detail: "externalId krever en tekstverdi.",
          scimType: "invalidFilter",
        };
      }
      and.push({
        externalId: groupStringClause(value, clause.operator) ?? value,
      });
      continue;
    }

    if (attribute === "displayname") {
      if (clause.operator === "pr") {
        and.push({ displayName: { not: "" } });
        continue;
      }
      if (value === null) {
        return {
          ok: false,
          detail: "displayName krever en tekstverdi.",
          scimType: "invalidFilter",
        };
      }
      and.push({
        displayName: groupStringClause(value, clause.operator) ?? value,
      });
      continue;
    }

    return {
      ok: false,
      detail: `SCIM-filter på «${clause.attribute}» støttes ikke for grupper.`,
      scimType: "invalidFilter",
    };
  }

  return { ok: true, data: and.length > 0 ? { AND: and } : {} };
}

function groupStringClause(
  value: string,
  operator: ScimFilterClause["operator"],
): Prisma.StringFilter | string | null {
  switch (operator) {
    case "eq":
      return value;
    case "ne":
      return { not: value };
    case "co":
      return { contains: value, mode: "insensitive" };
    case "sw":
      return { startsWith: value, mode: "insensitive" };
    case "pr":
      return { not: "" };
  }
}

function setMembers(
  base: ScimGroupInput,
  value: unknown,
  operation: "add" | "replace" | "remove",
): ScimGroupInput {
  const ids = memberIds(value);
  if (operation === "replace") return { ...base, memberIds: ids };
  if (operation === "add") {
    return {
      ...base,
      memberIds: Array.from(new Set([...base.memberIds, ...ids])),
    };
  }
  return {
    ...base,
    memberIds: base.memberIds.filter((id) => !ids.includes(id)),
  };
}

function applyGroupAttributes(
  base: ScimGroupInput,
  attributes: Record<string, unknown>,
): ScimParseResult<ScimGroupInput> {
  let next = { ...base };
  if ("displayName" in attributes) {
    const displayName = stringOrNull(attributes.displayName);
    if (!displayName) {
      return {
        ok: false,
        detail: "displayName kan ikke være tom.",
        scimType: "invalidValue",
      };
    }
    next = { ...next, displayName };
  }
  if ("externalId" in attributes) {
    next = { ...next, externalId: stringOrNull(attributes.externalId) };
  }
  if ("members" in attributes) {
    next = setMembers(next, attributes.members, "replace");
  }
  return { ok: true, data: next };
}

function memberPathId(path: string): string | null {
  const normalized = path.trim().replace(/\s+/g, "");
  const match =
    /^members(?:\[value(?:eq)?"([^"]+)"\])?$/i.exec(normalized) ?? null;
  if (!match) return null;
  if (match[1]) return match[1];
  return null;
}

/** PATCH på gruppe: displayName, externalId og medlemslisten. */
export function applyScimGroupPatch(
  base: ScimGroupInput,
  operations: readonly ScimPatchOperation[],
): ScimParseResult<ScimGroupInput> {
  let next = base;

  for (const operation of operations) {
    if (!operation.path) {
      if (operation.op === "remove") {
        return { ok: false, detail: "remove krever path.", scimType: "noTarget" };
      }
      const attributes = asRecord(operation.value);
      if (!attributes) {
        return {
          ok: false,
          detail: "value må være et objekt.",
          scimType: "invalidValue",
        };
      }
      const { schemas: _schemas, ...rest } = attributes;
      void _schemas;
      const applied = applyGroupAttributes(next, rest);
      if (!applied.ok) return applied;
      next = applied.data;
      continue;
    }

    const normalized = operation.path.trim().replace(/\s+/g, "").toLowerCase();
    if (normalized === "displayname") {
      const applied = applyGroupAttributes(next, {
        displayName: operation.op === "remove" ? null : operation.value,
      });
      if (!applied.ok) return applied;
      next = applied.data;
      continue;
    }
    if (normalized === "externalid") {
      next = {
        ...next,
        externalId:
          operation.op === "remove"
            ? null
            : stringOrNull(operation.value),
      };
      continue;
    }

    const memberId = memberPathId(operation.path);
    if (normalized === "members" || memberId || normalized.startsWith("members[")) {
      if (memberId) {
        if (operation.op === "remove") {
          next = {
            ...next,
            memberIds: next.memberIds.filter((id) => id !== memberId),
          };
        } else {
          next = setMembers(next, [memberId], "add");
        }
        continue;
      }
      next = setMembers(next, operation.value, operation.op);
      continue;
    }

    return {
      ok: false,
      detail: `PATCH-path «${operation.path}» støttes ikke for grupper.`,
      scimType: "noTarget",
    };
  }

  return { ok: true, data: next };
}

export function parseScimGroupPatch(
  body: unknown,
): ScimParseResult<ScimPatchOperation[]> {
  return parseScimPatch(body);
}

export { SCIM_PATCH_SCHEMA };
