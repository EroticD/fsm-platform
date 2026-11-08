// i18n-ignore-file: revisjonsloggen lagrer stabile norske handlingsstrenger.
import { WorkStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import {
  DEFAULT_WORK_ORDER_STATUS_CONFIG,
  setWorkOrderStatusConfig,
  statusKeysByCategory,
  type WorkOrderStatusCategory,
  type WorkOrderStatusConfig,
} from "@/lib/work-order-status";
import {
  can,
  fail,
  ok,
  toAuditActor,
  type ServiceActor,
  type ServiceResult,
} from "./actor";

type StatusGlobal = typeof globalThis & {
  __fsmWorkOrderStatusCache?: {
    expiresAt: number;
    config: WorkOrderStatusConfig;
    defaultStatus: WorkStatus;
  };
};

const CACHE_TTL_MS = 10_000;

export type WorkOrderStatusRow = {
  status: WorkStatus;
  category: WorkOrderStatusCategory;
  sortOrder: number;
  isActive: boolean;
};

export type WorkOrderStatusSettingsView = {
  rows: WorkOrderStatusRow[];
  defaultStatus: WorkStatus;
  updatedAt: Date | null;
};

function defaults(): WorkOrderStatusSettingsView {
  return {
    rows: (Object.values(WorkStatus) as WorkStatus[])
      .map((status) => ({
        status,
        category: DEFAULT_WORK_ORDER_STATUS_CONFIG[status].category,
        sortOrder: DEFAULT_WORK_ORDER_STATUS_CONFIG[status].sortOrder,
        isActive: DEFAULT_WORK_ORDER_STATUS_CONFIG[status].isActive,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    defaultStatus: "PENDING",
    updatedAt: null,
  };
}

/**
 * Leser statusoppsettet med kort prosesscache. Faller tilbake til standard
 * dersom tabellen ikke er migrert eller midlertidig utilgjengelig.
 */
export async function loadWorkOrderStatusConfig(
  options: { fresh?: boolean } = {},
): Promise<WorkOrderStatusSettingsView> {
  const scope = globalThis as StatusGlobal;
  const cached = scope.__fsmWorkOrderStatusCache;
  if (!options.fresh && cached && cached.expiresAt > Date.now()) {
    return {
      ...defaults(),
      rows: (Object.values(WorkStatus) as WorkStatus[]).map((status) => ({
        status,
        category: cached.config[status].category,
        sortOrder: cached.config[status].sortOrder,
        isActive: cached.config[status].isActive,
      })),
      defaultStatus: cached.defaultStatus,
    };
  }

  try {
    const [rows, settings] = await Promise.all([
      prisma.workOrderStatusSetting.findMany(),
      prisma.workOrderSettings.findUnique({ where: { id: "default" } }),
    ]);
    if (rows.length === 0) {
      const fallback = defaults();
      applyConfig(fallback.rows, fallback.defaultStatus);
      scope.__fsmWorkOrderStatusCache = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        config: toConfig(fallback.rows),
        defaultStatus: fallback.defaultStatus,
      };
      return fallback;
    }
    const mapped: WorkOrderStatusRow[] = rows.map((row) => ({
      status: row.status,
      category: row.category as WorkOrderStatusCategory,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
    }));
    const view: WorkOrderStatusSettingsView = {
      rows: mapped.sort((a, b) => a.sortOrder - b.sortOrder),
      defaultStatus: settings?.defaultStatus ?? "PENDING",
      updatedAt: settings?.updatedAt ?? null,
    };
    applyConfig(view.rows, view.defaultStatus);
    scope.__fsmWorkOrderStatusCache = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      config: toConfig(view.rows),
      defaultStatus: view.defaultStatus,
    };
    return view;
  } catch {
    const fallback = defaults();
    applyConfig(fallback.rows, fallback.defaultStatus);
    return fallback;
  }
}

function toConfig(rows: WorkOrderStatusRow[]): WorkOrderStatusConfig {
  const config = { ...DEFAULT_WORK_ORDER_STATUS_CONFIG };
  for (const row of rows) {
    config[row.status] = {
      category: row.category,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
    };
  }
  return config;
}

function applyConfig(
  rows: WorkOrderStatusRow[],
  defaultStatus: WorkStatus,
): void {
  setWorkOrderStatusConfig(toConfig(rows));
  // Standardstatusen brukes av createWorkOrder; den ligger i egen tabell.
  void defaultStatus;
}

export function invalidateWorkOrderStatusCache(): void {
  (globalThis as StatusGlobal).__fsmWorkOrderStatusCache = undefined;
}

export async function getWorkOrderStatusSettings(
  actor: ServiceActor | null | undefined,
): Promise<ServiceResult<WorkOrderStatusSettingsView>> {
  if (!actor?.isActive || (!can(actor, "settings.manage") && actor.role !== "ADMIN")) {
    return fail("forbidden");
  }
  return ok(await loadWorkOrderStatusConfig({ fresh: true }));
}

export type SaveWorkOrderStatusInput = {
  defaultStatus: unknown;
  statuses: Array<{
    status: unknown;
    category: unknown;
    sortOrder: unknown;
    isActive: unknown;
  }>;
};

const CATEGORIES = new Set(["OPEN", "PLANNED", "CLOSED"]);
const ALL_STATUSES = new Set(Object.values(WorkStatus));

/** Lagrer funksjon, rekkefølge og aktivering for hver innebygde status. */
export async function saveWorkOrderStatusSettings(
  actor: ServiceActor | null | undefined,
  input: SaveWorkOrderStatusInput,
): Promise<ServiceResult<WorkOrderStatusSettingsView>> {
  if (!actor?.isActive || (!can(actor, "settings.manage") && actor.role !== "ADMIN")) {
    return fail("forbidden");
  }

  const rows: WorkOrderStatusRow[] = [];
  for (const item of input.statuses) {
    const status = String(item.status ?? "");
    const category = String(item.category ?? "");
    if (!ALL_STATUSES.has(status as WorkStatus) || !CATEGORIES.has(category)) {
      return fail("invalid");
    }
    const sortOrder = Number.parseInt(String(item.sortOrder ?? "0"), 10);
    rows.push({
      status: status as WorkStatus,
      category: category as WorkOrderStatusCategory,
      sortOrder:
        Number.isFinite(sortOrder) && sortOrder >= 0
          ? Math.min(9999, sortOrder)
          : 0,
      isActive: item.isActive === true || item.isActive === "true" || item.isActive === "on",
    });
  }

  // Alle innebygde statuser må være med, ellers ville en manglende rad få
  // standardfunksjon og skjule en administrativ endring.
  if (rows.length !== ALL_STATUSES.size) return fail("invalid");
  if (!rows.some((row) => row.category === "OPEN")) return fail("invalid");
  if (!rows.some((row) => row.category === "CLOSED")) return fail("invalid");

  const defaultStatus = String(input.defaultStatus ?? "");
  if (!ALL_STATUSES.has(defaultStatus as WorkStatus)) return fail("invalid");
  const defaultCategory = rows.find((row) => row.status === defaultStatus)?.category;
  if (defaultCategory === "CLOSED") return fail("invalid");

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      await tx.workOrderStatusSetting.upsert({
        where: { status: row.status },
        create: {
          status: row.status,
          category: row.category,
          sortOrder: row.sortOrder,
          isActive: row.isActive,
          updatedById: actor.id,
        },
        update: {
          category: row.category,
          sortOrder: row.sortOrder,
          isActive: row.isActive,
          updatedById: actor.id,
        },
      });
    }
    await tx.workOrderSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        defaultStatus: defaultStatus as WorkStatus,
        updatedById: actor.id,
      },
      update: {
        defaultStatus: defaultStatus as WorkStatus,
        updatedById: actor.id,
      },
    });
    await audit(tx, {
      entityType: "WorkOrderSettings",
      entityId: "default",
      action: "Oppdaterte oppdragsstatuser og lukkefunksjon",
      actor: toAuditActor(actor),
      metadata: {
        defaultStatus,
        categories: Object.fromEntries(rows.map((row) => [row.status, row.category])),
        active: rows.filter((row) => row.isActive).map((row) => row.status),
      },
    });
  });

  invalidateWorkOrderStatusCache();
  return ok(await loadWorkOrderStatusConfig({ fresh: true }));
}

export async function resetWorkOrderStatusSettings(
  actor: ServiceActor | null | undefined,
): Promise<ServiceResult<WorkOrderStatusSettingsView>> {
  const view = defaults();
  return saveWorkOrderStatusSettings(actor, {
    defaultStatus: view.defaultStatus,
    statuses: view.rows.map((row) => ({
      status: row.status,
      category: row.category,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
    })),
  });
}

/** Standardstatus for nye oppdrag, med fallback til PENDING. */
export async function getDefaultWorkOrderStatus(): Promise<WorkStatus> {
  const view = await loadWorkOrderStatusConfig();
  return view.defaultStatus;
}

/** Alle statuser i en kategori, brukt av lister og filtre. */
export function workOrderStatusesInCategory(
  category: WorkOrderStatusCategory,
): WorkStatus[] {
  return statusKeysByCategory(category);
}
