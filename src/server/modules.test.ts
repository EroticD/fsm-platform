import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceActor } from "@/server/actor";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  moduleState: {
    count: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
    upsert: vi.fn(),
  },
  prisma: {} as Record<string, unknown>,
}));

vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/prisma", () => {
  const prisma = {
    moduleState: mocks.moduleState,
    $transaction: vi.fn(async (run: (tx: unknown) => unknown) =>
      run({ moduleState: mocks.moduleState }),
    ),
  };
  mocks.prisma = prisma;
  return { default: prisma };
});

import {
  applyModulePreset,
  invalidateModuleCache,
  listModuleAdminView,
  moduleEnabled,
  readModuleStates,
  setModuleEnabled,
} from "./modules";

const admin: ServiceActor = {
  id: "admin-1",
  name: "Admin",
  email: "admin@example.test",
  role: "ADMIN",
  isActive: true,
  departmentId: null,
  permissionsCustomized: false,
  permissions: null,
  roleDefinition: null,
};

const office: ServiceActor = { ...admin, id: "office-1", role: "OFFICE" };

function rows(states: Record<string, boolean>) {
  return Object.entries(states).map(([key, enabled]) => ({ key, enabled }));
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateModuleCache();
  mocks.moduleState.count.mockResolvedValue(1);
  mocks.moduleState.findMany.mockResolvedValue(
    rows({
      core: true,
      calendar: true,
      reports: true,
      equipment: true,
      contracts: true,
      portal: true,
      booking: true,
      documents: true,
      sms: true,
      map: true,
      tracking: true,
      reviews: true,
      transfer: true,
      auditExport: true,
      api: true,
      sso: true,
      offline: true,
      quotes: false,
      invoicing: false,
      inventory: false,
      fieldExpenses: false,
      bi: false,
    }),
  );
  mocks.moduleState.upsert.mockResolvedValue({});
  mocks.moduleState.createMany.mockResolvedValue({ count: 0 });
});

describe("modultilstand", () => {
  it("leser alle rader og kjernen er alltid på", async () => {
    const states = await readModuleStates();
    expect(states.core).toBe(true);
    expect(states.calendar).toBe(true);
    expect(states.quotes).toBe(false);
    expect(await moduleEnabled("core")).toBe(true);
    expect(await moduleEnabled("calendar")).toBe(true);
  });

  it("initialiserer med core-preset når tabellen er tom og env sier core", async () => {
    const previous = process.env.MODULE_PRESET;
    process.env.MODULE_PRESET = "core";
    mocks.moduleState.count.mockResolvedValue(0);
    mocks.moduleState.findMany.mockResolvedValue(
      rows({
        core: true,
        calendar: false,
        reports: false,
        equipment: false,
        contracts: false,
        portal: false,
        booking: false,
        documents: false,
        sms: false,
        map: false,
        tracking: false,
        reviews: false,
        transfer: false,
        auditExport: false,
        api: false,
        sso: false,
        offline: false,
        quotes: false,
        invoicing: false,
        inventory: false,
        fieldExpenses: false,
        bi: false,
      }),
    );

    try {
      const states = await readModuleStates({ fresh: true });
      expect(mocks.moduleState.createMany).toHaveBeenCalledTimes(1);
      const data = mocks.moduleState.createMany.mock.calls[0][0].data as Array<{
        key: string;
        enabled: boolean;
      }>;
      expect(data.find((row) => row.key === "core")?.enabled).toBe(true);
      expect(data.find((row) => row.key === "calendar")?.enabled).toBe(false);
      expect(data.find((row) => row.key === "quotes")?.enabled).toBe(false);
      expect(states.calendar).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.MODULE_PRESET;
      else process.env.MODULE_PRESET = previous;
    }
  });

  it("kjerne-only og full preset setter forventede rader", async () => {
    await applyModulePreset("core");
    const coreUpserts = mocks.moduleState.upsert.mock.calls.map(
      (call) => call[0].update.enabled,
    );
    expect(coreUpserts.filter(Boolean)).toHaveLength(1);

    mocks.moduleState.upsert.mockClear();
    await applyModulePreset("full");
    const fullUpserts = mocks.moduleState.upsert.mock.calls.map(
      (call) => call[0].update.enabled,
    );
    expect(fullUpserts.filter(Boolean).length).toBeGreaterThan(10);
  });
});

describe("setModuleEnabled", () => {
  it("avviser ikke-administrator og kjernen", async () => {
    await expect(setModuleEnabled(office, "sms", false)).resolves.toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    await expect(setModuleEnabled(admin, "core", false)).resolves.toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("avviser å slå på en modul uten avhengigheter", async () => {
    mocks.moduleState.findMany.mockResolvedValue(
      rows({ core: true, portal: true, calendar: false, booking: false }),
    );
    const result = await setModuleEnabled(admin, "booking", true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("conflict");
      expect(result.details).toMatchObject({
        code: "module.missingDependencies",
      });
    }
    expect(mocks.moduleState.upsert).not.toHaveBeenCalled();
  });

  it("avviser å slå av en modul som andre bruker", async () => {
    mocks.moduleState.findMany.mockResolvedValue(
      rows({
        core: true,
        portal: true,
        calendar: true,
        booking: true,
        equipment: false,
      }),
    );
    const result = await setModuleEnabled(admin, "portal", false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.details).toMatchObject({ code: "module.hasDependents" });
    }
    expect(mocks.moduleState.upsert).not.toHaveBeenCalled();
  });

  it("skriver tilstand og revisjonsrad i samme transaksjon", async () => {
    const result = await setModuleEnabled(admin, "sms", false);

    expect(result).toEqual({
      ok: true,
      data: { key: "sms", enabled: false },
    });
    expect(mocks.moduleState.upsert).toHaveBeenCalledWith({
      where: { key: "sms" },
      update: { enabled: false, updatedBy: "admin-1" },
      create: { key: "sms", enabled: false, updatedBy: "admin-1" },
    });
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit.mock.calls[0][1]).toMatchObject({
      entityType: "ModuleState",
      entityId: "sms",
      metadata: { module: "sms", enabled: false, previous: true },
    });
  });

  it("re-enabling tvinger ny lesing og cachen invalideres ved endring", async () => {
    await readModuleStates();
    mocks.moduleState.findMany.mockClear();

    // Cachetreff: ingen ny spørring.
    await readModuleStates();
    expect(mocks.moduleState.findMany).not.toHaveBeenCalled();

    await setModuleEnabled(admin, "sms", false);
    await moduleEnabled("sms");
    // Én lesing inne i transaksjonen og én etter at cachen er invalidert.
    expect(mocks.moduleState.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("listModuleAdminView", () => {
  it("viser avhengigheter, blokkeringer og planlagte moduler", async () => {
    mocks.moduleState.findMany.mockResolvedValue(
      rows({
        core: true,
        portal: true,
        calendar: false,
        booking: false,
        equipment: true,
        transfer: true,
        documents: false,
      }),
    );
    const view = await listModuleAdminView();
    const booking = view.find((row) => row.key === "booking");
    expect(booking?.missingDependencies).toEqual(["calendar"]);
    const transfer = view.find((row) => row.key === "transfer");
    expect(transfer?.enabled).toBe(true);
    expect(transfer?.enabledDependents).toEqual([]);
    expect(view.find((row) => row.key === "quotes")?.status).toBe("active");
  });
});
