// i18n-ignore-file: revisjons- og loggtekst er stabile driftsdata.
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { cleanEmail } from "@/lib/sanitize";
import { logger } from "@/lib/logger";
import {
  ssoDisplayName,
  ssoEmail,
  ssoEmailDomainAllowed,
  ssoEmailVerified,
  ssoGroups,
  ssoRoleFromGroups,
  ssoSubject,
  type SsoClaims,
  type SsoProviderConfig,
} from "@/lib/sso";

/**
 * Kobler en OIDC-innlogging til en lokal bruker.
 *
 * Reglene er bevisst strenge:
 *  - identiteten matches først på (provider, sub), aldri på e-post alene
 *  - en ny identitet kan bare kobles til en eksisterende aktiv bruker med
 *    bekreftet e-post fra leverandøren
 *  - kundeportalbrukere og brukere med kundetilhørighet kobles aldri
 *  - auto-provisjonering er av som standard, og oppretter i så fall en inaktiv
 *    bruker med laveste rolle og uten passord
 *  - rollestyring fra grupper skjer bare når SYNC_ROLES er slått på
 *
 * Tjenesten tar konfigurasjon og claims som argumenter, slik at reglene kan
 * testes uten en ekte IdP.
 */

export const SSO_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  isTwoFactorEnabled: true,
  sessionVersion: true,
  departmentId: true,
  customerId: true,
} satisfies Prisma.UserSelect;

export type SsoSessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  isActive: boolean;
  isTwoFactorEnabled: boolean;
  sessionVersion: number;
  departmentId: string | null;
  customerId: string | null;
};

export type SsoFailureReason =
  | "invalid_claims"
  | "missing_email"
  | "unverified_email"
  | "domain_not_allowed"
  | "inactive"
  | "not_provisioned"
  | "role_conflict"
  | "invalid_role"
  | "invalid_department"
  | "customer_account"
  | "identity_conflict"
  | "server_error";

export type SsoSignInResult =
  | {
      ok: true;
      user: SsoSessionUser;
      provisioned: boolean;
      linked: boolean;
      roleChanged: boolean;
      matchedGroups: string[];
    }
  | { ok: false; reason: SsoFailureReason };

type UserRow = Prisma.UserGetPayload<{ select: typeof SSO_USER_SELECT }>;

function toSessionUser(user: UserRow): SsoSessionUser {
  return {
    id: user.id,
    email: user.email ?? "",
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    isTwoFactorEnabled: user.isTwoFactorEnabled,
    sessionVersion: user.sessionVersion,
    departmentId: user.departmentId,
    customerId: user.customerId,
  };
}

function isProtectedAccount(user: {
  role?: string | null;
  customerId?: string | null;
}): boolean {
  return user.role === "CUSTOMER" || Boolean(user.customerId);
}

async function roleExists(role: string): Promise<boolean> {
  if (!role || role === "CUSTOMER") return false;
  const row = await prisma.role.findUnique({
    where: { key: role },
    select: { key: true },
  });
  return Boolean(row);
}

/**
 * Slår opp avdeling på id eller navn. En konfigurert standardavdeling som ikke
 * finnes skal stoppe innloggingen i stedet for å gi en bruker uten synlig data.
 */
async function resolveDepartmentId(
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

async function applyRoleSync(
  user: UserRow,
  role: string,
  config: SsoProviderConfig,
  matchedGroups: string[],
): Promise<{ user: UserRow; roleChanged: boolean; invalidRole: boolean }> {
  if (!config.syncRoles || !role || role === user.role) {
    return { user, roleChanged: false, invalidRole: false };
  }
  if (!(await roleExists(role))) {
    return { user, roleChanged: false, invalidRole: true };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.user.update({
      where: { id: user.id },
      data: { role, sessionVersion: { increment: 1 } },
      select: SSO_USER_SELECT,
    });
    await audit(tx, {
      entityType: "User",
      entityId: user.id,
      action: `SSO: rolle oppdatert fra grupper (${config.slug})`,
      actor: {
        id: user.id,
        name: user.name,
        email: user.email,
        departmentId: user.departmentId,
      },
      metadata: {
        provider: config.slug,
        previousRole: user.role,
        role,
        groups: matchedGroups,
      },
    });
    return next;
  });
  return { user: updated, roleChanged: true, invalidRole: false };
}

export async function resolveSsoUser(
  config: SsoProviderConfig,
  claims: SsoClaims,
): Promise<SsoSignInResult> {
  try {
    const subject = ssoSubject(claims);
    const email = ssoEmail(claims);
    if (!subject || !email) {
      return { ok: false, reason: subject ? "missing_email" : "invalid_claims" };
    }
    if (!ssoEmailVerified(claims)) {
      return { ok: false, reason: "unverified_email" };
    }
    if (!ssoEmailDomainAllowed(email, config.allowedEmailDomains)) {
      return { ok: false, reason: "domain_not_allowed" };
    }

    const groups = ssoGroups(claims, config.groupsClaim);
    const mapping = ssoRoleFromGroups(groups, config.groupRoleMap);
    if (mapping.conflict.length > 0) {
      return { ok: false, reason: "role_conflict" };
    }

    const identity = await prisma.ssoIdentity.findUnique({
      where: {
        provider_subject: { provider: config.slug, subject },
      },
      select: {
        id: true,
        userId: true,
        user: { select: SSO_USER_SELECT },
      },
    });

    if (identity) {
      if (!identity.user.isActive) return { ok: false, reason: "inactive" };
      if (isProtectedAccount(identity.user)) {
        return { ok: false, reason: "customer_account" };
      }

      await prisma.ssoIdentity.update({
        where: { id: identity.id },
        data: { lastLoginAt: new Date(), email },
        select: { id: true },
      });

      const synced = await applyRoleSync(
        identity.user,
        mapping.role ?? "",
        config,
        mapping.matchedGroups,
      );
      if (synced.invalidRole) return { ok: false, reason: "invalid_role" };
      return {
        ok: true,
        user: toSessionUser(synced.user),
        provisioned: false,
        linked: false,
        roleChanged: synced.roleChanged,
        matchedGroups: mapping.matchedGroups,
      };
    }

    const existing = await prisma.user.findUnique({
      where: { email },
      select: SSO_USER_SELECT,
    });

    if (existing) {
      if (!existing.isActive) return { ok: false, reason: "inactive" };
      if (isProtectedAccount(existing)) {
        return { ok: false, reason: "customer_account" };
      }

      try {
        await prisma.$transaction(async (tx) => {
          const created = await tx.ssoIdentity.create({
            data: {
              provider: config.slug,
              subject,
              userId: existing.id,
              email,
              lastLoginAt: new Date(),
            },
            select: { id: true },
          });
          await audit(tx, {
            entityType: "User",
            entityId: existing.id,
            action: `SSO: koblet konto til ${config.slug}`,
            actor: {
              id: existing.id,
              name: existing.name,
              email: existing.email,
              departmentId: existing.departmentId,
            },
            metadata: {
              provider: config.slug,
              identityId: created.id,
              subject,
              groups: mapping.matchedGroups,
            },
          });
        });
      } catch (error) {
        // Samtidige innlogginger kan kollidere på den unike nøkkelen. Da er
        // identiteten allerede opprettet, og vi kan fortsette med samme bruker.
        if (!isUniqueConstraintError(error)) throw error;
      }

      const synced = await applyRoleSync(
        existing,
        mapping.role ?? "",
        config,
        mapping.matchedGroups,
      );
      if (synced.invalidRole) return { ok: false, reason: "invalid_role" };
      return {
        ok: true,
        user: toSessionUser(synced.user),
        provisioned: false,
        linked: true,
        roleChanged: synced.roleChanged,
        matchedGroups: mapping.matchedGroups,
      };
    }

    if (!config.autoProvision) {
      return { ok: false, reason: "not_provisioned" };
    }

    const role = mapping.role ?? config.defaultRole;
    if (!(await roleExists(role))) {
      return { ok: false, reason: "invalid_role" };
    }
    const department = await resolveDepartmentId(config.defaultDepartment);
    if (!department.ok) return { ok: false, reason: "invalid_department" };

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: ssoDisplayName(claims),
          role,
          departmentId: department.id,
          // Auto-provisjonerte kontoer er inaktive med mindre det er slått
          // eksplisitt på. En administrator kan aktivere dem etterpå.
          isActive: config.autoProvisionActive,
          emailVerified: new Date(),
          // Bevisst ingen password: SSO-kontoer skal ikke ha en lokal
          // passordsinnlogging som omgår identitetsleverandøren.
        },
        select: SSO_USER_SELECT,
      });
      const identity = await tx.ssoIdentity.create({
        data: {
          provider: config.slug,
          subject,
          userId: user.id,
          email,
          lastLoginAt: new Date(),
        },
        select: { id: true },
      });
      await audit(tx, {
        entityType: "User",
        entityId: user.id,
        action: `SSO: opprettet bruker via ${config.slug}`,
        actor: {
          id: user.id,
          name: user.name,
          email: user.email,
          departmentId: user.departmentId,
        },
        metadata: {
          provider: config.slug,
          identityId: identity.id,
          subject,
          role,
          active: user.isActive,
          groups: mapping.matchedGroups,
        },
      });
      return user;
    });

    if (!created.isActive) return { ok: false, reason: "inactive" };

    return {
      ok: true,
      user: toSessionUser(created),
      provisioned: true,
      linked: false,
      roleChanged: false,
      matchedGroups: mapping.matchedGroups,
    };
  } catch (error) {
    logger.error("SSO-innlogging feilet", {
      provider: config.slug,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, reason: "server_error" };
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

/**
 * Revisjonsrad for en vellykket SSO-innlogging. Skrives best effort, slik som
 * passordinnloggingen; en feilet logg skal ikke hindre innlogging. Claims
 * lagres aldri – bare leverandør, identitet og om brukeren ble opprettet.
 */
export async function recordSsoLogin(
  user: SsoSessionUser,
  config: SsoProviderConfig,
  outcome: { provisioned: boolean; linked: boolean; roleChanged: boolean },
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: "User",
        entityId: user.id,
        action: `Logget inn via SSO: ${config.slug}`,
        userName: user.name || user.email || "Ukjent",
        actorId: user.id,
        departmentId: user.departmentId,
        metadata: {
          provider: config.slug,
          provisioned: outcome.provisioned,
          linked: outcome.linked,
          roleChanged: outcome.roleChanged,
        },
      },
    });
  } catch {
    // Revisjonsraden kan inneholde e-post. Logg aldri den rå feilen.
    logger.warn("Kunne ikke logge SSO-innlogging", { provider: config.slug });
  }
}

/** Normaliserer e-post likt som passordinnloggingen. */
export function normalizeSsoEmail(value: string): string {
  return cleanEmail(value);
}
