// i18n-ignore-file: SCIM-egenskaper og feilkoder er stabile protokollverdier.
import type { Prisma } from "@prisma/client";
import { cleanEmail } from "@/lib/sanitize";

/**
 * SCIM 2.0-hjelpere.
 *
 * Modulen er ren og DB-fri, slik at filter-, PATCH- og feilformat kan testes
 * uten en database. Tjenestelaget i `src/server/scim-users.ts` gjør oppslagene.
 */

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_ENTERPRISE_SCHEMA =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
export const SCIM_LIST_SCHEMA =
  "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_PATCH_SCHEMA =
  "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const SCIM_ERROR_SCHEMA =
  "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_CONTENT_TYPE = "application/scim+json; charset=utf-8";

export const SCIM_DEFAULT_COUNT = 100;
export const SCIM_MAX_COUNT = 100;

export type ScimUserInput = {
  userName: string;
  externalId: string | null;
  active: boolean | null;
  name: {
    formatted: string | null;
    givenName: string | null;
    familyName: string | null;
  } | null;
  emails: Array<{ value: string; primary: boolean; type: string | null }>;
  roles: string[];
  groups: string[];
  department: string | null;
};

export type ScimParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; detail: string; scimType?: string };

/** SCIM-feilformatet fra RFC 7644, med status som streng. */
export function scimErrorBody(
  status: number,
  detail: string,
  scimType?: string,
): {
  schemas: string[];
  detail: string;
  status: string;
  scimType?: string;
} {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    detail,
    status: String(status),
    ...(scimType ? { scimType } : {}),
  };
}

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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      result.push(item.trim());
      continue;
    }
    const record = asRecord(item);
    if (!record) continue;
    const label = record.value ?? record.display ?? record.name ?? record.id;
    if (typeof label === "string" && label.trim()) result.push(label.trim());
  }
  return Array.from(new Set(result));
}

function parseEmails(value: unknown): ScimUserInput["emails"] {
  if (!Array.isArray(value)) return [];
  const emails: ScimUserInput["emails"] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    const raw = typeof item === "string" ? item : record?.value;
    const email = typeof raw === "string" ? cleanEmail(raw) : "";
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    emails.push({
      value: email,
      primary: record?.primary === true || record?.primary === "true",
      type: stringOrNull(record?.type),
    });
  }
  return emails;
}

/**
 * Leser og validerer en SCIM User. `userName` eller en e-post i `emails` må
 * være en gyldig adresse, fordi den lokale brukeren identifiseres på e-post.
 * Passordfelt ignoreres bevisst – SCIM skal aldri sette lokale passord.
 */
export function parseScimUser(
  body: unknown,
  options: { requireUserName?: boolean } = {},
): ScimParseResult<ScimUserInput> {
  const record = asRecord(body);
  if (!record) return { ok: false, detail: "Body må være et JSON-objekt." };

  const userName = stringOrNull(record.userName) ?? "";
  if (options.requireUserName !== false && !userName) {
    return {
      ok: false,
      detail: "userName er påkrevd.",
      scimType: "invalidValue",
    };
  }

  const emails = parseEmails(record.emails);
  const primaryEmail =
    emails.find((email) => email.primary)?.value ?? emails[0]?.value ?? "";
  const email = userName.includes("@") ? cleanEmail(userName) : primaryEmail;
  if (!email.includes("@")) {
    return {
      ok: false,
      detail: "Brukeren må ha en gyldig e-postadresse i userName eller emails.",
      scimType: "invalidValue",
    };
  }

  const nameRecord = asRecord(record.name);
  const name = nameRecord
    ? {
        formatted: stringOrNull(nameRecord.formatted),
        givenName: stringOrNull(nameRecord.givenName),
        familyName: stringOrNull(nameRecord.familyName),
      }
    : null;

  const enterprise = asRecord(record[SCIM_ENTERPRISE_SCHEMA]);
  const department =
    stringOrNull(enterprise?.department) ??
    stringOrNull(record.department) ??
    null;

  return {
    ok: true,
    data: {
      userName: email,
      externalId: stringOrNull(record.externalId),
      active:
        typeof record.active === "boolean"
          ? record.active
          : record.active === "true"
            ? true
            : record.active === "false"
              ? false
              : null,
      name:
        name && (name.formatted || name.givenName || name.familyName)
          ? name
          : null,
      emails,
      roles: stringArray(record.roles),
      groups: stringArray(record.groups),
      department,
    },
  };
}

export type ScimUserRow = {
  id: string;
  email: string | null;
  name: string | null;
  scimExternalId: string | null;
  isActive: boolean;
  role: string;
  departmentId: string | null;
  department?: { id: string; name: string } | null;
  /** SCIM-grupper brukeren er direkte medlem av. */
  groups?: Array<{ id: string; displayName: string }> | null;
};

/** Nåværende bruker som SCIM-input, brukt som grunnlag for PATCH. */
export function scimInputFromUser(user: ScimUserRow): ScimUserInput {
  return {
    userName: user.email ?? "",
    externalId: user.scimExternalId,
    active: user.isActive,
    name: user.name
      ? { formatted: user.name, givenName: null, familyName: null }
      : null,
    emails: user.email
      ? [{ value: user.email, primary: true, type: "work" }]
      : [],
    roles: user.role ? [user.role] : [],
    groups: [],
    // Behold gjeldende avdeling når en PATCH ikke nevner den.
    department: user.departmentId,
  };
}

export function scimUserName(input: ScimUserInput): string {
  return input.emails.find((email) => email.primary)?.value ?? input.userName;
}

export function scimDisplayName(input: ScimUserInput): string | null {
  if (input.name?.formatted) return input.name.formatted;
  const parts = [input.name?.givenName, input.name?.familyName].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

/** SCIM-representasjon av en lokal bruker. Hemmeligheter er aldri med. */
export function scimUserResource(
  user: ScimUserRow,
  baseUrl = "",
): Record<string, unknown> {
  const name = user.name;
  const department = user.department?.name ?? null;
  return {
    schemas: department
      ? [SCIM_USER_SCHEMA, SCIM_ENTERPRISE_SCHEMA]
      : [SCIM_USER_SCHEMA],
    id: user.id,
    externalId: user.scimExternalId,
    userName: user.email ?? user.id,
    name: {
      formatted: name,
      givenName: null,
      familyName: null,
    },
    displayName: name,
    emails: user.email
      ? [{ value: user.email, primary: true, type: "work" }]
      : [],
    active: user.isActive,
    roles: [{ value: user.role, primary: true, type: "work" }],
    // Bare gruppe-id og visningsnavn – aldri medlemslister på andre brukere.
    groups: (user.groups ?? []).map((group) => ({
      value: group.id,
      display: group.displayName,
      type: "direct",
      $ref: `${baseUrl}/api/scim/v2/Groups/${group.id}`,
    })),
    ...(department
      ? {
          [SCIM_ENTERPRISE_SCHEMA]: { department },
        }
      : {}),
    meta: {
      resourceType: "User",
      location: `${baseUrl}/api/scim/v2/Users/${user.id}`,
    },
  };
}

export function scimListResponse(
  resources: unknown[],
  totalResults: number,
  startIndex: number,
): Record<string, unknown> {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

export type ScimFilterOperator = "eq" | "ne" | "co" | "sw" | "pr";

export type ScimFilterClause = {
  attribute: string;
  operator: ScimFilterOperator;
  value: string | boolean | null;
};

type Token =
  | { type: "word"; value: string }
  | { type: "string"; value: string }
  | { type: "lparen" }
  | { type: "rparen" };

function tokenizeFilter(input: string): Token[] | null {
  const tokens: Token[] = [];
  const regex = /"((?:[^"\\]|\\.)*)"|([()])|([A-Za-z0-9_.:$@-]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    if (match.index !== lastIndex && input.slice(lastIndex, match.index).trim()) {
      return null;
    }
    lastIndex = regex.lastIndex;
    if (match[1] !== undefined) {
      tokens.push({
        type: "string",
        value: match[1].replace(/\\(.)/g, "$1"),
      });
    } else if (match[2] === "(") {
      tokens.push({ type: "lparen" });
    } else if (match[2] === ")") {
      tokens.push({ type: "rparen" });
    } else if (match[3]) {
      tokens.push({ type: "word", value: match[3] });
    }
  }
  if (input.slice(lastIndex).trim()) return null;
  return tokens;
}

/**
 * Støtter `attr op value` kombinert med `and`. `or` og parenteser avvises
 * bevisst: et filter vi ikke forstår skal gi 400, ikke et bredere svar enn
 * IdP-en ba om.
 */
export function parseScimFilter(
  raw: string | null,
): ScimParseResult<ScimFilterClause[]> {
  if (!raw || !raw.trim()) return { ok: true, data: [] };

  const tokens = tokenizeFilter(raw.trim());
  if (!tokens || tokens.length === 0) {
    return { ok: false, detail: "Ugyldig SCIM-filter.", scimType: "invalidFilter" };
  }

  const clauses: ScimFilterClause[] = [];
  let index = 0;
  for (;;) {
    const attribute = tokens[index];
    const operator = tokens[index + 1];
    if (!attribute || attribute.type !== "word" || !operator || operator.type !== "word") {
      return { ok: false, detail: "Ugyldig SCIM-filter.", scimType: "invalidFilter" };
    }
    const op = operator.value.toLowerCase();
    if (!["eq", "ne", "co", "sw", "pr"].includes(op)) {
      return {
        ok: false,
        detail: `SCIM-filteroperatoren «${operator.value}» støttes ikke.`,
        scimType: "invalidFilter",
      };
    }
    index += 2;

    let value: string | boolean | null = null;
    if (op !== "pr") {
      const token = tokens[index];
      if (!token || (token.type !== "word" && token.type !== "string")) {
        return {
          ok: false,
          detail: "SCIM-filteret mangler en verdi.",
          scimType: "invalidFilter",
        };
      }
      value =
        token.type === "string"
          ? token.value
          : token.value === "true"
            ? true
            : token.value === "false"
              ? false
              : token.value;
      index += 1;
    }

    clauses.push({
      attribute: attribute.value,
      operator: op as ScimFilterOperator,
      value,
    });

    if (index >= tokens.length) break;
    const separator = tokens[index];
    if (!separator || separator.type !== "word" || separator.value.toLowerCase() !== "and") {
      return {
        ok: false,
        detail: "Bare «and» kan kombinere SCIM-filtere.",
        scimType: "invalidFilter",
      };
    }
    index += 1;
  }

  return { ok: true, data: clauses };
}

function stringClause(
  value: string | boolean | null,
  operator: ScimFilterOperator,
): Prisma.StringFilter | string | null {
  if (typeof value !== "string") return null;
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

/** Oversetter de støttede SCIM-attributtene til et Prisma-filter. */
export function scimFilterWhere(
  clauses: readonly ScimFilterClause[],
): ScimParseResult<Prisma.UserWhereInput> {
  const and: Prisma.UserWhereInput[] = [];
  for (const clause of clauses) {
    const attribute = clause.attribute.toLowerCase();
    if (attribute === "active") {
      if (clause.operator === "pr") continue;
      if (typeof clause.value !== "boolean" || clause.operator === "co" || clause.operator === "sw") {
        return {
          ok: false,
          detail: "active støtter bare eq, ne og pr.",
          scimType: "invalidFilter",
        };
      }
      if (clause.operator === "eq") {
        and.push({ isActive: clause.value });
      } else if (clause.operator === "ne") {
        and.push({ isActive: !clause.value });
      }
      continue;
    }

    if (
      attribute === "id" ||
      attribute === "externalid" ||
      attribute === "username" ||
      attribute === "emails" ||
      attribute === "emails.value" ||
      attribute === "email" ||
      attribute === "displayname" ||
      attribute === "name.formatted" ||
      attribute === "role"
    ) {
      if (clause.operator === "pr") {
        if (attribute === "id") continue;
        if (attribute === "externalid") {
          and.push({ scimExternalId: { not: null } });
        } else if (
          attribute === "username" ||
          attribute === "emails" ||
          attribute === "emails.value" ||
          attribute === "email"
        ) {
          and.push({ email: { not: null } });
        } else if (attribute === "role") {
          and.push({ role: { not: "" } });
        } else {
          and.push({ name: { not: null } });
        }
        continue;
      }

      const value = typeof clause.value === "string" ? clause.value : null;
      if (value === null) {
        return {
          ok: false,
          detail: `${clause.attribute} krever en tekstverdi.`,
          scimType: "invalidFilter",
        };
      }
      if (attribute === "id") {
        and.push({ id: stringClause(value, clause.operator) ?? value });
      } else if (attribute === "externalid") {
        and.push({
          scimExternalId: stringClause(value, clause.operator) ?? value,
        });
      } else if (
        attribute === "username" ||
        attribute === "emails" ||
        attribute === "emails.value" ||
        attribute === "email"
      ) {
        and.push({ email: stringClause(cleanEmail(value), clause.operator) ?? cleanEmail(value) });
      } else if (attribute === "role") {
        and.push({ role: stringClause(value.toUpperCase(), clause.operator) ?? value.toUpperCase() });
      } else {
        and.push({ name: stringClause(value, clause.operator) ?? value });
      }
      continue;
    }

    return {
      ok: false,
      detail: `SCIM-filter på «${clause.attribute}» støttes ikke.`,
      scimType: "invalidFilter",
    };
  }

  return { ok: true, data: and.length > 0 ? { AND: and } : {} };
}

export type ScimPagination = { startIndex: number; count: number; skip: number };

/** `count=0` er lov og betyr «bare totalResults». */
export function parseScimPagination(url: URL): ScimPagination {
  const startRaw = Number(url.searchParams.get("startIndex") ?? "1");
  const countRaw = Number(url.searchParams.get("count") ?? SCIM_DEFAULT_COUNT);
  const startIndex =
    Number.isFinite(startRaw) && startRaw >= 1 ? Math.trunc(startRaw) : 1;
  const count = Number.isFinite(countRaw)
    ? Math.min(Math.max(Math.trunc(countRaw), 0), SCIM_MAX_COUNT)
    : SCIM_DEFAULT_COUNT;
  return { startIndex, count, skip: (startIndex - 1) * count };
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

export type ScimPatchOperation = {
  op: "add" | "replace" | "remove";
  path: string | null;
  value: unknown;
};

export function parseScimPatch(
  body: unknown,
): ScimParseResult<ScimPatchOperation[]> {
  const record = asRecord(body);
  if (!record || !Array.isArray(record.Operations)) {
    return {
      ok: false,
      detail: "PATCH må inneholde en Operations-liste.",
      scimType: "invalidSyntax",
    };
  }
  if (record.Operations.length === 0) {
    return { ok: false, detail: "Operations er tom.", scimType: "invalidSyntax" };
  }

  const operations: ScimPatchOperation[] = [];
  for (const item of record.Operations) {
    const operation = asRecord(item);
    const op = typeof operation?.op === "string" ? operation.op.toLowerCase() : "";
    if (op !== "add" && op !== "replace" && op !== "remove") {
      return {
        ok: false,
        detail: "Ukjent PATCH-operasjon. Bruk add, replace eller remove.",
        scimType: "invalidSyntax",
      };
    }
    const path = stringOrNull(operation?.path);
    if (op === "remove" && !path) {
      return {
        ok: false,
        detail: "remove krever path.",
        scimType: "noTarget",
      };
    }
    if (op !== "remove" && operation?.value === undefined) {
      return {
        ok: false,
        detail: `PATCH-operasjonen ${op} mangler value.`,
        scimType: "invalidSyntax",
      };
    }
    if (op !== "remove" && !path && !asRecord(operation?.value)) {
      return {
        ok: false,
        detail: "PATCH uten path må ha et objekt som value.",
        scimType: "invalidSyntax",
      };
    }
    operations.push({ op, path, value: operation?.value });
  }
  return { ok: true, data: operations };
}

function normalizePath(path: string): string {
  return path
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\[[^\]]*\]/g, "");
}

function valueAsString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function applyAttributes(
  base: ScimUserInput,
  attributes: Record<string, unknown>,
): ScimParseResult<ScimUserInput> {
  const next: ScimUserInput = { ...base };

  if ("userName" in attributes) {
    const value = valueAsString(attributes.userName);
    if (!value || !value.includes("@")) {
      return { ok: false, detail: "userName må være en e-postadresse.", scimType: "invalidValue" };
    }
    next.userName = cleanEmail(value);
    next.emails = next.emails.length
      ? next.emails
      : [{ value: next.userName, primary: true, type: "work" }];
  }
  if ("externalId" in attributes) {
    next.externalId = stringOrNull(attributes.externalId);
  }
  if ("active" in attributes) {
    if (typeof attributes.active !== "boolean") {
      return { ok: false, detail: "active må være true eller false.", scimType: "invalidValue" };
    }
    next.active = attributes.active;
  }
  if ("name" in attributes) {
    const name = asRecord(attributes.name);
    if (!name) {
      return { ok: false, detail: "name må være et objekt.", scimType: "invalidValue" };
    }
    next.name = {
      formatted: stringOrNull(name.formatted),
      givenName: stringOrNull(name.givenName),
      familyName: stringOrNull(name.familyName),
    };
  }
  if ("displayName" in attributes) {
    const displayName = stringOrNull(attributes.displayName);
    if (displayName) {
      next.name = { formatted: displayName, givenName: null, familyName: null };
    }
  }
  if ("emails" in attributes) {
    const emails = parseEmails(attributes.emails);
    if (emails.length === 0) {
      return { ok: false, detail: "emails må inneholde en gyldig adresse.", scimType: "invalidValue" };
    }
    next.emails = emails;
  }
  if ("roles" in attributes) {
    next.roles = stringArray(attributes.roles);
  }
  if ("groups" in attributes) {
    next.groups = stringArray(attributes.groups);
  }
  if ("department" in attributes) {
    next.department = stringOrNull(attributes.department);
  }
  return { ok: true, data: next };
}

/**
 * Anvender PATCH-operasjoner på en normalisert bruker. Ukjente paths avvises
 * med 400 i stedet for å bli stille ignorert, slik at en IdP-konfigurasjon
 * som ikke virker blir synlig i provisjoneringsloggen.
 */
export function applyScimPatch(
  base: ScimUserInput,
  operations: readonly ScimPatchOperation[],
): ScimParseResult<ScimUserInput> {
  let next = base;

  for (const operation of operations) {
    if (!operation.path) {
      if (operation.op === "remove") {
        return { ok: false, detail: "remove krever path.", scimType: "noTarget" };
      }
      const attributes = asRecord(operation.value);
      if (!attributes) {
        return { ok: false, detail: "value må være et objekt.", scimType: "invalidValue" };
      }
      const mergeable: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(attributes)) {
        if (key === SCIM_ENTERPRISE_SCHEMA) {
          const enterprise = asRecord(value);
          if (enterprise && "department" in enterprise) {
            mergeable.department = enterprise.department;
          }
        } else if (key !== "schemas") {
          mergeable[key] = value;
        }
      }
      const applied = applyAttributes(next, mergeable);
      if (!applied.ok) return applied;
      next = applied.data;
      continue;
    }

    const normalized = normalizePath(operation.path);
    // Enterprise-utvidelsen har en full URN som path; avdeling er det eneste
    // feltet vi støtter derfra.
    const path = normalized.endsWith(":department")
      ? "department"
      : normalized;
    const value = operation.value;

    if (path === "active") {
      if (operation.op === "remove") {
        return { ok: false, detail: "active kan ikke fjernes.", scimType: "noTarget" };
      }
      if (typeof value !== "boolean") {
        return { ok: false, detail: "active må være true eller false.", scimType: "invalidValue" };
      }
      next = { ...next, active: value };
      continue;
    }

    if (path === "username") {
      if (operation.op === "remove") {
        return { ok: false, detail: "userName kan ikke fjernes.", scimType: "noTarget" };
      }
      const applied = applyAttributes(next, { userName: value });
      if (!applied.ok) return applied;
      next = applied.data;
      continue;
    }

    if (path === "externalid") {
      next = {
        ...next,
        externalId: operation.op === "remove" ? null : stringOrNull(value),
      };
      continue;
    }

    if (path === "name" || path === "displayname") {
      if (operation.op === "remove") {
        next = { ...next, name: null };
      } else if (path === "displayname") {
        const applied = applyAttributes(next, { displayName: value });
        if (!applied.ok) return applied;
        next = applied.data;
      } else {
        const applied = applyAttributes(next, { name: value });
        if (!applied.ok) return applied;
        next = applied.data;
      }
      continue;
    }

    if (path === "name.formatted" || path === "name.givenname" || path === "name.familyname") {
      const field =
        path === "name.formatted"
          ? "formatted"
          : path === "name.givenname"
            ? "givenName"
            : "familyName";
      const current = next.name ?? {
        formatted: null,
        givenName: null,
        familyName: null,
      };
      next = {
        ...next,
        name: {
          ...current,
          [field]:
            operation.op === "remove" ? null : valueAsString(value) ?? current[field],
        },
      };
      continue;
    }

    if (path === "emails" || path === "emails.value") {
      if (operation.op === "remove") {
        next = { ...next, emails: [] };
      } else if (path === "emails.value") {
        const email = valueAsString(value);
        if (!email || !email.includes("@")) {
          return { ok: false, detail: "emails.value må være en gyldig adresse.", scimType: "invalidValue" };
        }
        next = {
          ...next,
          emails: [{ value: cleanEmail(email), primary: true, type: "work" }],
        };
      } else {
        const applied = applyAttributes(next, { emails: value });
        if (!applied.ok) return applied;
        next = applied.data;
      }
      continue;
    }

    if (path === "roles" || path === "groups") {
      const values =
        operation.op === "remove" ? [] : stringArray(value);
      if (path === "roles") {
        next = {
          ...next,
          roles:
            operation.op === "add"
              ? Array.from(new Set([...next.roles, ...values]))
              : values,
        };
      } else {
        next = {
          ...next,
          groups:
            operation.op === "add"
              ? Array.from(new Set([...next.groups, ...values]))
              : values,
        };
      }
      continue;
    }

    if (path === "department") {
      next = {
        ...next,
        department: operation.op === "remove" ? null : stringOrNull(value),
      };
      continue;
    }

    return {
      ok: false,
      detail: `PATCH-path «${operation.path}» støttes ikke.`,
      scimType: "noTarget",
    };
  }

  return { ok: true, data: next };
}
