// i18n-ignore-file: interne filstier for staging.
import fs from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "@/lib/uploads";

export function transferRoot(): string {
  return path.join(uploadDir(), ".transfer");
}

export function jobStagingDir(jobId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) {
    throw new Error("Ugyldig jobb-id");
  }
  return path.join(transferRoot(), jobId);
}

/** Oppretter staging-mappen med restriktive rettigheter (0700). */
export async function ensureJobStaging(jobId: string): Promise<string> {
  await fs.mkdir(transferRoot(), { recursive: true, mode: 0o700 });
  const directory = jobStagingDir(jobId);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}
