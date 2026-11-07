import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/prisma";
import type { ServiceActor } from "@/server/actor";
import {
  applyModulePreset,
  invalidateModuleCache,
  listModuleAdminView,
  moduleEnabled,
  readModuleStates,
  setModuleEnabled,
} from "@/server/modules";
import { integrationEnabled } from "@/test/integration-helpers";

const describeIntegration = integrationEnabled ? describe : describe.skip;

const admin: ServiceActor = {
  id: "it-module-admin",
  name: "Moduladmin",
  email: null,
  role: "ADMIN",
  isActive: true,
  departmentId: null,
  permissionsCustomized: false,
  permissions: null,
  roleDefinition: null,
};

describeIntegration("moduler mot ekte PostgreSQL", () => {
  beforeAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { entityType: "ModuleState" },
    });
    await prisma.moduleState.deleteMany({});
    invalidateModuleCache();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { entityType: "ModuleState" },
    });
    await prisma.moduleState.deleteMany({});
    await applyModulePreset("full");
    invalidateModuleCache();
  });

  it("initialiserer core-only fra MODULE_PRESET og full fra standard", async () => {
    const previous = process.env.MODULE_PRESET;
    try {
      process.env.MODULE_PRESET = "core";
      await prisma.moduleState.deleteMany({});
      invalidateModuleCache();
      const core = await readModuleStates({ fresh: true });
      expect(core.core).toBe(true);
      expect(core.calendar).toBe(false);
      expect(core.documents).toBe(false);
      const rows = await prisma.moduleState.findMany();
      expect(rows.find((row) => row.key === "calendar")?.enabled).toBe(false);

      delete process.env.MODULE_PRESET;
      await prisma.moduleState.deleteMany({});
      invalidateModuleCache();
      const full = await readModuleStates({ fresh: true });
      expect(full.core).toBe(true);
      expect(full.calendar).toBe(true);
      expect(full.documents).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.MODULE_PRESET;
      else process.env.MODULE_PRESET = previous;
      await applyModulePreset("full");
    }
  });

  it("slår av og på med revisjonsspor og avhengighetsvakter", async () => {
    await applyModulePreset("full");
    invalidateModuleCache();

    const off = await setModuleEnabled(admin, "sms", false);
    expect(off.ok).toBe(true);
    expect(await moduleEnabled("sms")).toBe(false);
    const enAudit = await prisma.auditLog.findFirst({
      where: { entityType: "ModuleState", entityId: "sms" },
      orderBy: { seq: "desc" },
    });
    expect(enAudit?.metadata).toMatchObject({ module: "sms", enabled: false });

    // Re-enable restores access immediately.
    const on = await setModuleEnabled(admin, "sms", true);
    expect(on.ok).toBe(true);
    expect(await moduleEnabled("sms")).toBe(true);

    // Turning off portal must be refused while booking is on.
    const blocked = await setModuleEnabled(admin, "portal", false);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe("conflict");
      expect(blocked.details).toMatchObject({ code: "module.hasDependents" });
    }

    // Turning on booking requires portal + calendar.
    await setModuleEnabled(admin, "booking", false);
    await setModuleEnabled(admin, "tracking", false);
    await setModuleEnabled(admin, "calendar", false);
    const missing = await setModuleEnabled(admin, "booking", true);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.details).toMatchObject({
        code: "module.missingDependencies",
      });
    }
    await setModuleEnabled(admin, "calendar", true);
    await setModuleEnabled(admin, "tracking", true);
    await setModuleEnabled(admin, "booking", true);
  });

  it("bevarer data når en modul slås av", async () => {
    await applyModulePreset("core");
    await setModuleEnabled(admin, "equipment", true);
    const department = await prisma.department.create({
      data: { name: `Modultest ${Date.now()}` },
    });
    const customer = await prisma.customer.create({
      data: {
        name: `Modulkunde ${Date.now()}`,
        departmentId: department.id,
      },
    });
    const product = await prisma.product.create({
      data: { model: "Modulpumpe", customerId: customer.id },
    });

    await setModuleEnabled(admin, "equipment", false);
    expect(await moduleEnabled("equipment")).toBe(false);
    expect(
      await prisma.product.findUnique({ where: { id: product.id } }),
    ).not.toBeNull();

    await setModuleEnabled(admin, "equipment", true);
    expect(
      await prisma.product.findUnique({ where: { id: product.id } }),
    ).not.toBeNull();

    await prisma.product.delete({ where: { id: product.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
    await prisma.department.delete({ where: { id: department.id } });
    await applyModulePreset("full");
  });

  it("viser avhengigheter og tilstand for administrator", async () => {
    await applyModulePreset("core");
    invalidateModuleCache();
    const view = await listModuleAdminView();
    const calendar = view.find((row) => row.key === "calendar");
    const booking = view.find((row) => row.key === "booking");
    expect(calendar?.enabled).toBe(false);
    expect(booking?.enabled).toBe(false);
    expect(booking?.missingDependencies).toEqual(["portal", "calendar"]);
    expect(view.find((row) => row.key === "core")?.core).toBe(true);
    await applyModulePreset("full");
  });
});
