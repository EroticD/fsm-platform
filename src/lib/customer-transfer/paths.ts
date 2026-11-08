// i18n-ignore-file: interne lagringsnøkler for staging.
import { normaliseStorageKey } from "@/lib/storage";

/**
 * Intern staging for kundeoverføringer ligger i samme lagringslag som
 * opplastingene, men under en skjult rot. Da ser alle app-instanser de samme
 * filene, og avstemmingen kan jobbe uavhengig av hvilken replika som tok
 * jobben. `/uploads`-ruten nekter å serve nøkler som starter med «.».
 */
export const TRANSFER_ROOT_KEY = ".transfer";

export function jobStagingPrefix(jobId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) {
    throw new Error("Ugyldig jobb-id");
  }
  return normaliseStorageKey(`${TRANSFER_ROOT_KEY}/${jobId}`);
}

export function jobStagingKey(jobId: string, name: string): string {
  return normaliseStorageKey(`${jobStagingPrefix(jobId)}/${name}`);
}

/**
 * Historisk navn. Returnerer nå en lagringsnøkkel, ikke en absolutt sti.
 * Funksjonen lager ingen mapper; driveren oppretter det den trenger.
 */
export async function ensureJobStaging(jobId: string): Promise<string> {
  return jobStagingPrefix(jobId);
}

/** @deprecated Bruk `jobStagingPrefix`. Beholdt for eldre kall og tester. */
export function jobStagingDir(jobId: string): string {
  return jobStagingPrefix(jobId);
}
