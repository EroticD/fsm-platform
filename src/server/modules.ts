// i18n-ignore-file: revisjonshandlinger er lagrede driftsdata, ikke UI-tekst.
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { can, fail, isAdminActor, ok, toAuditActor } from "@/server/actor";
import type { ServiceActor, ServiceResult } from "@/server/actor";
import {
  MODULES,
  MODULE_BY_KEY,
  CORE_MODULE,
  enabledDependents,
  enabledModulesFor,
  isModuleKey,
  missingDependencies,
  moduleKeysForPreset,
  modulePresetFromEnv,
  type ModuleKey,
} from "@/lib/modules";

/**
 * Leser og skriver installasjonsnivåmoduler.
 *
 * Tilstanden ligger i `ModuleState`, men er cachet kort i prosessen fordi
 * navigasjon, sider og handlinger spør ofte. `setModuleEnabled` invaliderer
 * cachen lokalt; andre instanser ser endringen innen `MODULE_CACHE_TTL_MS`.
 * Det er bevisst en kort TTL og ikke en evig cache: en modul som slås av skal
 * stoppe nye forespørsler raskt, også i en annen replika.
 */

export const MODULE_CACHE_TTL_MS = 10_000;

export type ModuleStates = Record<ModuleKey, boolean>;

type ModuleCache = {
  states: ModuleStates;
  expiresAt: number;
};

type ModuleGlobal = typeof globalThis & {
  __fsmModuleStateCache?: ModuleCache;
};

/** Hvilken standardtilstand en modul har når raden mangler. */
function defaultEnabled(key: ModuleKey): boolean {
  const definition = MODULE_BY_KEY[key];
  if (definition.core) return true;
  // Nye aktive moduler er på i eksisterende installasjoner (bakoverkompatibelt).
  // P2-plassholdere er av til de faktisk leveres.
  return definition.status === "active";
}

function statesFromRows(
  rows: ReadonlyArray<{ key: string; enabled: boolean }>,
): ModuleStates {
  const rowByKey = new Map(rows.map((row) => [row.key, row.enabled]));
  const states = {} as ModuleStates;
  for (const mod of MODULES) {
    states[mod.key] = mod.core
      ? true
      : (rowByKey.get(mod.key) ?? defaultEnabled(mod.key));
  }
  return states;
}

/**
 * Første oppstart uten rader får preset fra `MODULE_PRESET`.
 * `full` (standard) bevarer dagens oppførsel for eksisterende installasjoner;
 * `core` gir en kjerne-only installasjon. Seed-skriptet kan kjøre samme
 * initialisering eksplisitt.
 */
async function ensureModuleStates(): Promise<void> {
  const count = await prisma.moduleState.count();
  if (count > 0) return;

  const preset = moduleKeysForPreset(modulePresetFromEnv());
  await prisma.moduleState.createMany({
    data: MODULES.map((mod) => ({
      key: mod.key,
      enabled: mod.core || (mod.status === "active" && preset.has(mod.key)),
    })),
    skipDuplicates: true,
  });
}

/** Leser alle modultilstander med kort prosesscache. */
export async function readModuleStates(
  options: { fresh?: boolean } = {},
): Promise<ModuleStates> {
  const scope = globalThis as ModuleGlobal;
  const cached = scope.__fsmModuleStateCache;
  if (!options.fresh && cached && cached.expiresAt > Date.now()) {
    return cached.states;
  }

  try {
    await ensureModuleStates();
    const rows = await prisma.moduleState.findMany({
      select: { key: true, enabled: true },
    });
    const states = statesFromRows(rows);
    scope.__fsmModuleStateCache = {
      states,
      expiresAt: Date.now() + MODULE_CACHE_TTL_MS,
    };
    return states;
  } catch {
    // Uten database kan vi ikke vite hva som er av. Alle aktive moduler
    // behandles som på, slik at en kortvarig DB-feil ikke låser hele appen.
    // Autentisering og datatilgang feiler uansett selvstendig.
    const states = {} as ModuleStates;
    for (const mod of MODULES) {
      states[mod.key] = mod.core || mod.status === "active";
    }
    return states;
  }
}

/** Alle modulnøkler som er på nå. Kjernen er alltid med. */
export async function listEnabledModules(): Promise<ModuleKey[]> {
  return enabledModulesFor(await readModuleStates());
}

/** Er en modul på? Kjernen er alltid på. */
export async function moduleEnabled(key: ModuleKey): Promise<boolean> {
  if (key === CORE_MODULE || MODULE_BY_KEY[key]?.core) return true;
  if (!MODULE_BY_KEY[key]) return false;
  return (await readModuleStates())[key] === true;
}

/** Alias for tjenestelag og ruter som vil lese som en vakt. */
export async function requireModule(key: ModuleKey): Promise<boolean> {
  return moduleEnabled(key);
}

export class ModuleDisabledError extends Error {
  readonly moduleKey: ModuleKey;

  constructor(key: ModuleKey) {
    super(`Module disabled: ${key}`);
    this.name = "ModuleDisabledError";
    this.moduleKey = key;
  }
}

/**
 * Kaster når modulen er av. Brukes der et kall ikke har en naturlig
 * `notFound()`/`forbidden`-retur, f.eks. i tjenestelag og jobber.
 */
export async function assertModule(key: ModuleKey): Promise<void> {
  if (!(await moduleEnabled(key))) throw new ModuleDisabledError(key);
}

/** Bare for tester og bevisst invalidering. */
export function invalidateModuleCache(): void {
  const scope = globalThis as ModuleGlobal;
  scope.__fsmModuleStateCache = undefined;
}

export type SetModuleResult = ServiceResult<{
  key: ModuleKey;
  enabled: boolean;
}>;

/**
 * Slår en modul på eller av. Bare administrator kan gjøre dette.
 *
 * Avhengigheter håndheves i begge retninger:
 *   - en modul kan ikke slås på før avhengighetene er på;
 *   - en modul kan ikke slås av mens en avhengig modul er på.
 *
 * Endringen og revisjonsraden skrives i samme transaksjon.
 */
export async function setModuleEnabled(
  actor: ServiceActor,
  key: string,
  enabled: boolean,
): Promise<SetModuleResult> {
  if (!isAdminActor(actor) || !can(actor, "settings.manage")) {
    return fail("forbidden");
  }
  if (!isModuleKey(key) || !MODULE_BY_KEY[key]) return fail("not_found");
  const moduleKey = key as ModuleKey;
  if (MODULE_BY_KEY[moduleKey].core) {
    return fail("invalid", { code: "mod.coreLocked" });
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.moduleState.findMany({
      select: { key: true, enabled: true },
    });
    const states = statesFromRows(rows);

    if (enabled) {
      const missing = missingDependencies(moduleKey, states);
      if (missing.length > 0) {
        return fail("conflict", { code: "module.missingDependencies", modules: missing });
      }
    } else {
      const dependents = enabledDependents(moduleKey, states);
      if (dependents.length > 0) {
        return fail("conflict", { code: "module.hasDependents", modules: dependents });
      }
    }

    const previous = states[moduleKey];
    if (previous === enabled) {
      return ok({ key: moduleKey, enabled });
    }

    await tx.moduleState.upsert({
      where: { key: moduleKey },
      update: { enabled, updatedBy: actor.id },
      create: { key: moduleKey, enabled, updatedBy: actor.id },
    });

    const label = MODULE_BY_KEY[moduleKey].labelKey;
    await audit(tx, {
      entityType: "ModuleState",
      entityId: moduleKey,
      action: enabled ? `Slått på modulen ${label}` : `Slått av modulen ${label}`,
      actor: toAuditActor(actor),
      metadata: {
        module: moduleKey,
        enabled,
        previous,
        labelKey: label,
      },
    });

    invalidateModuleCache();
    return ok({ key: moduleKey, enabled });
  });
}

/** Modultilstandene slik innstillingssiden trenger dem. */
export type ModuleAdminView = {
  key: ModuleKey;
  enabled: boolean;
  core: boolean;
  status: "active" | "planned";
  dependencies: ModuleKey[];
  dependents: ModuleKey[];
  missingDependencies: ModuleKey[];
  enabledDependents: ModuleKey[];
};

export async function listModuleAdminView(): Promise<ModuleAdminView[]> {
  const states = await readModuleStates({ fresh: true });
  return MODULES.map((mod) => ({
    key: mod.key,
    enabled: states[mod.key] === true,
    core: mod.core,
    status: mod.status,
    dependencies: [...mod.dependencies],
    dependents: MODULES.filter(
      (candidate) =>
        !candidate.core && candidate.dependencies.includes(mod.key),
    ).map((candidate) => candidate.key),
    missingDependencies: missingDependencies(mod.key, states),
    enabledDependents: enabledDependents(mod.key, states),
  }));
}

/** Brukes av seed/preset-skriptet i dokumentasjonen. */
export async function applyModulePreset(
  preset: "core" | "full",
): Promise<ModuleStates> {
  const enabled = moduleKeysForPreset(preset);
  await prisma.$transaction(async (tx) => {
    for (const mod of MODULES) {
      const value =
        mod.core || (mod.status === "active" && enabled.has(mod.key));
      await tx.moduleState.upsert({
        where: { key: mod.key },
        update: { enabled: value },
        create: { key: mod.key, enabled: value },
      });
    }
  });
  invalidateModuleCache();
  return readModuleStates({ fresh: true });
}
