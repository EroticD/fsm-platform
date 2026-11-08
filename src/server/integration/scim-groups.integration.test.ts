import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import { integrationEnabled, unique } from "@/test/integration-helpers";
import type { ScimTokenActor } from "@/server/scim-tokens";
import {
  createScimGroup,
  deleteScimGroup,
  getScimGroup,
  listScimGroups,
  patchScimGroup,
} from "@/server/scim-groups";
import { getScimUser } from "@/server/scim-users";

const describeIntegration = integrationEnabled ? describe : describe.skip;

const actor: ScimTokenActor = {
  tokenId: "integration-token",
  tokenName: "Integrasjon",
  createdById: null,
};

const env = {
  SCIM_GROUP_ROLE_MAP: '{"IT-Office":"OFFICE","IT-Admin":"ADMIN"}',
  SCIM_GROUP_DEPARTMENT_MAP: '{"IT-Oslo":"IT-Oslo-avd"}',
};

describeIntegration("SCIM Groups mot ekte database", () => {
  let departmentId = "";
  let officeUserId = "";
  let adminUserId = "";
  let groupId = "";
  const prefix = unique("scim-group-it");

  beforeAll(async () => {
    for (const [key, label] of [
      ["USER", "Bruker (SCIM-gruppe)"],
      ["OFFICE", "Kontor (SCIM-gruppe)"],
      ["ADMIN", "Admin (SCIM-gruppe)"],
    ] as const) {
      await prisma.role.upsert({
        where: { key },
        update: {},
        create: { key, label, permissions: [], isSystem: true },
      });
    }
    const department = await prisma.department.create({
      data: { name: `${prefix}-avd` },
    });
    departmentId = department.id;

    const office = await prisma.user.create({
      data: {
        email: `${prefix}-office@example.test`,
        role: "USER",
        isActive: true,
        departmentId,
      },
    });
    officeUserId = office.id;

    const admin = await prisma.user.create({
      data: {
        email: `${prefix}-admin@example.test`,
        role: "USER",
        isActive: true,
        departmentId,
      },
    });
    adminUserId = admin.id;
  });

  afterAll(async () => {
    await prisma.scimGroup.deleteMany({
      where: { displayName: { startsWith: prefix } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: prefix } },
    });
    if (departmentId) {
      await prisma.department.deleteMany({ where: { id: departmentId } });
    }
  });

  it("oppretter gruppe, lister og filtrerer medlemmer", async () => {
    const result = await createScimGroup(
      {
        displayName: `${prefix}-office`,
        externalId: `${prefix}-ext`,
        members: [{ value: officeUserId }],
      },
      actor,
      {
        ...env,
        SCIM_GROUP_ROLE_MAP: `{"${prefix}-office":"OFFICE"}`,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    groupId = String(result.data.id);

    const stored = await prisma.scimGroup.findUnique({
      where: { id: groupId },
      include: { members: true },
    });
    expect(stored?.members).toHaveLength(1);

    const user = await prisma.user.findUnique({ where: { id: officeUserId } });
    expect(user?.role).toBe("OFFICE");

    const listed = await listScimGroups(
      {
        filter: `displayName co "${prefix}-OFFICE" and members eq "${officeUserId}"`,
        startIndex: 1,
        count: 10,
      },
      "https://fsm.example",
    );
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.data.totalResults).toBe(1);
    expect(listed.data.resources[0]).toMatchObject({
      displayName: `${prefix}-office`,
      members: [{ value: officeUserId }],
    });

    const got = await getScimGroup(groupId, "https://fsm.example");
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.data.id).toBe(groupId);

    const userResource = await getScimUser(officeUserId, "https://fsm.example");
    expect(userResource.ok).toBe(true);
    if (!userResource.ok) return;
    expect(userResource.data.groups).toEqual([
      expect.objectContaining({
        value: groupId,
        display: `${prefix}-office`,
      }),
    ]);
  });

  it("gir aldri ADMIN uten SCIM_ALLOW_ADMIN", async () => {
    const group = await createScimGroup(
      {
        displayName: `${prefix}-admin`,
        members: [{ value: adminUserId }],
      },
      actor,
      {
        SCIM_GROUP_ROLE_MAP: `{"${prefix}-admin":"ADMIN"}`,
      },
    );
    expect(group.ok).toBe(true);

    const user = await prisma.user.findUnique({ where: { id: adminUserId } });
    expect(user?.role).toBe("USER");

    const auditRow = await prisma.auditLog.findFirst({
      where: {
        entityId: adminUserId,
        action: { contains: "ADMIN-gruppe ignorert" },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).toBeTruthy();
  });

  it("oppdaterer medlemskap med PATCH og revisjonslogger endringen", async () => {
    const result = await patchScimGroup(
      groupId,
      {
        Operations: [
          { op: "replace", path: "members", value: [{ value: adminUserId }] },
        ],
      },
      actor,
      {
        SCIM_GROUP_ROLE_MAP: `{"${prefix}-office":"OFFICE"}`,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.members).toEqual([
      expect.objectContaining({ value: adminUserId }),
    ]);

    const auditRow = await prisma.auditLog.findFirst({
      where: { entityId: groupId, action: "Oppdaterte gruppe via SCIM" },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow).toBeTruthy();
    expect(
      await prisma.user.findUnique({ where: { id: officeUserId } }),
    ).toBeTruthy();
  });

  it("sletter gruppen og beholder brukerne", async () => {
    const result = await deleteScimGroup(groupId, actor);
    expect(result.ok).toBe(true);
    expect(
      await prisma.scimGroup.findUnique({ where: { id: groupId } }),
    ).toBeNull();
    expect(
      await prisma.user.findUnique({ where: { id: officeUserId } }),
    ).toBeTruthy();
  });
});
