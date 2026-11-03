import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { SsoProviderConfig } from "@/lib/sso";
import type { ScimTokenActor } from "@/server/scim-tokens";
import {
  createScimUser,
  deactivateScimUser,
  listScimUsers,
  patchScimUser,
} from "@/server/scim-users";
import { resolveSsoUser } from "@/server/sso";

const describeIntegration = integrationEnabled ? describe : describe.skip;

const actor: ScimTokenActor = {
  tokenId: "integration-token",
  tokenName: "Integrasjon",
  createdById: null,
};

function ssoConfig(overrides: Partial<SsoProviderConfig> = {}): SsoProviderConfig {
  return {
    slug: "it-entra",
    id: "sso-it-entra",
    displayName: "IT Entra",
    issuer: "https://login.example.test/tenant/v2.0",
    discoveryUrl:
      "https://login.example.test/tenant/v2.0/.well-known/openid-configuration",
    clientId: "client",
    clientSecret: "secret",
    scopes: ["openid", "email", "profile"],
    autoProvision: false,
    autoProvisionActive: false,
    defaultRole: "USER",
    defaultDepartment: null,
    allowedEmailDomains: [],
    groupsClaim: "groups",
    groupRoleMap: {},
    syncRoles: false,
    ...overrides,
  };
}

describeIntegration("SCIM og SSO mot ekte database", () => {
  let departmentId = "";
  const emailPrefix = unique("scim-it");
  const emails: string[] = [];

  beforeAll(async () => {
    for (const [key, label] of [
      ["USER", "Bruker (IT)"],
      ["OFFICE", "Kontor (IT)"],
      ["CUSTOMER", "Kunde (IT)"],
    ] as const) {
      await prisma.role.upsert({
        where: { key },
        update: {},
        create: { key, label, permissions: [], isSystem: true },
      });
    }

    const department = await prisma.department.create({
      data: { name: unique("IT-SCIM-avd") },
    });
    departmentId = department.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { startsWith: emailPrefix } },
    });
    if (departmentId) {
      await prisma.department.deleteMany({ where: { id: departmentId } });
    }
  });

  it("oppretter, filtrerer, oppdaterer og deaktiverer en SCIM-bruker", async () => {
    const email = `${emailPrefix}-kari@example.test`;
    emails.push(email);

    const created = await createScimUser(
      {
        userName: email,
        externalId: `${emailPrefix}-ext`,
        active: false,
        name: { givenName: "Kari", familyName: "SCIM" },
      },
      actor,
      {
        SCIM_DEFAULT_DEPARTMENT: departmentId,
        SCIM_DEFAULT_ROLE: "USER",
      },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const stored = await prisma.user.findUnique({ where: { email } });
    expect(stored).toMatchObject({
      email,
      name: "Kari SCIM",
      role: "USER",
      isActive: false,
      departmentId,
    });
    expect(stored?.password).toBeNull();
    expect(stored?.scimExternalId).toBe(`${emailPrefix}-ext`);

    const listed = await listScimUsers(
      {
        filter: `userName eq "${email}" and active eq false`,
        startIndex: 1,
        count: 10,
      },
      "https://fsm.example",
    );
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.totalResults).toBe(1);
    expect(listed.data.resources[0]).toMatchObject({
      userName: email,
      externalId: `${emailPrefix}-ext`,
      active: false,
    });

    const patched = await patchScimUser(
      stored!.id,
      {
        Operations: [
          { op: "replace", path: "active", value: true },
          { op: "replace", path: "roles", value: [{ value: "OFFICE" }] },
        ],
      },
      actor,
      {},
    );
    expect(patched.ok).toBe(true);

    const afterPatch = await prisma.user.findUnique({ where: { id: stored!.id } });
    expect(afterPatch).toMatchObject({ isActive: true, role: "OFFICE" });
    expect(afterPatch!.sessionVersion).toBeGreaterThan(stored!.sessionVersion);

    const deactivated = await deactivateScimUser(stored!.id, actor);
    expect(deactivated.ok).toBe(true);
    const afterDelete = await prisma.user.findUnique({ where: { id: stored!.id } });
    expect(afterDelete?.isActive).toBe(false);
    expect(afterDelete!.sessionVersion).toBeGreaterThan(
      afterPatch!.sessionVersion,
    );
  });

  it("avviser duplikat e-post med 409", async () => {
    const email = `${emailPrefix}-dup@example.test`;
    emails.push(email);

    const first = await createScimUser({ userName: email }, actor, {
      SCIM_DEFAULT_DEPARTMENT: departmentId,
      SCIM_DEFAULT_ROLE: "USER",
    });
    expect(first.ok).toBe(true);

    const second = await createScimUser({ userName: email }, actor, {
      SCIM_DEFAULT_DEPARTMENT: departmentId,
      SCIM_DEFAULT_ROLE: "USER",
    });
    expect(second).toMatchObject({ ok: false, status: 409 });
  });

  it("kobler SSO-identitet på bekreftet e-post og gjenbruker sub", async () => {
    const email = `${emailPrefix}-sso@example.test`;
    emails.push(email);
    const user = await prisma.user.create({
      data: {
        email,
        name: "SSO Kari",
        role: "USER",
        departmentId,
        isActive: true,
        emailVerified: new Date(),
      },
    });

    const config = ssoConfig();
    const first = await resolveSsoUser(config, {
      sub: `${emailPrefix}-sub`,
      email,
      email_verified: true,
      name: "SSO Kari",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.linked).toBe(true);
    expect(first.user.id).toBe(user.id);

    const identity = await prisma.ssoIdentity.findUnique({
      where: {
        provider_subject: {
          provider: config.slug,
          subject: `${emailPrefix}-sub`,
        },
      },
    });
    expect(identity?.userId).toBe(user.id);

    const second = await resolveSsoUser(config, {
      sub: `${emailPrefix}-sub`,
      email: "endret@example.test",
      email_verified: true,
      name: "Endret",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.user.id).toBe(user.id);
    expect(second.linked).toBe(false);
  });

  it("kobler ikke på uverifisert e-post", async () => {
    const email = `${emailPrefix}-uverifisert@example.test`;
    emails.push(email);
    await prisma.user.create({
      data: {
        email,
        name: "Uverifisert",
        role: "USER",
        departmentId,
        isActive: true,
      },
    });

    const result = await resolveSsoUser(ssoConfig(), {
      sub: `${emailPrefix}-uverifisert`,
      email,
      email_verified: false,
    });
    expect(result).toEqual({ ok: false, reason: "unverified_email" });
    const identity = await prisma.ssoIdentity.findFirst({
      where: { subject: `${emailPrefix}-uverifisert` },
    });
    expect(identity).toBeNull();
  });
});
