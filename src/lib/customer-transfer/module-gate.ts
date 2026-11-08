// i18n-ignore-file: modulnøkler er tekniske data.
import { moduleIsOn, type ModuleKey } from "@/lib/modules";
import { readModuleStates } from "@/server/modules";

/**
 * Entitetstyper som krever en bestemt modul i mål. Brukes både av synkron
 * dry-run og av den vedvarende importworkeren, slik at en pakke ikke kan
 * importere data fra en modul som er slått av.
 */
export const IMPORT_MODULE_BY_ENTITY: Readonly<Record<string, ModuleKey>> = {
  Product: "equipment",
  EquipmentCategory: "equipment",
  EquipmentQrCode: "equipment",
  MaintenancePlan: "equipment",
  MaintenancePlanOccurrence: "equipment",
  MeterReading: "equipment",
  Contract: "contracts",
  ContractLine: "contracts",
  SlaPolicy: "contracts",
  PriceList: "contracts",
  Document: "documents",
  DocumentVersion: "documents",
  DocumentFolder: "documents",
  Report: "reports",
  ReportUnit: "reports",
  ReportRevision: "reports",
  Template: "reports",
  PortalUser: "portal",
};

export async function disabledImportModules(
  entities: ReadonlyArray<{ type: string }>,
): Promise<ModuleKey[]> {
  const states = await readModuleStates();
  const disabled = new Set<ModuleKey>();
  for (const entity of entities) {
    if (!Object.hasOwn(IMPORT_MODULE_BY_ENTITY, entity.type)) continue;
    const mod = IMPORT_MODULE_BY_ENTITY[entity.type];
    if (mod && !moduleIsOn(states, mod)) disabled.add(mod);
  }
  return [...disabled];
}
