// i18n-ignore-file: migreringsverktøy for drift, ikke UI.
import { createHash } from "node:crypto";
import { LocalStorageDriver } from "../src/lib/storage/local-driver";
import { S3StorageDriver } from "../src/lib/storage/s3-driver";
import {
  resolveUploadRoot,
  s3ConfigFromEnv,
} from "../src/lib/storage/config";
import { contentTypeForKey } from "../src/lib/storage/keys";

type Options = {
  source: string;
  dryRun: boolean;
  verify: boolean;
  check: boolean;
  force: boolean;
  includeInternal: boolean;
  limit: number | null;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    source: resolveUploadRoot(),
    dryRun: false,
    verify: false,
    check: false,
    force: false,
    includeInternal: false,
    limit: null,
  };
  for (const argument of argv) {
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--verify") options.verify = true;
    else if (argument === "--check") options.check = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--include-internal") options.includeInternal = true;
    else if (argument.startsWith("--source=")) {
      options.source = argument.slice("--source=".length);
    } else if (argument.startsWith("--limit=")) {
      const parsed = Number.parseInt(argument.slice("--limit=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit må være et positivt heltall");
      }
      options.limit = parsed;
    } else {
      throw new Error(`Ukjent argument: ${argument}`);
    }
  }
  return options;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.S3_BUCKET) {
    throw new Error("S3_BUCKET mangler. Migreringen skriver til S3/MinIO.");
  }
  if (!options.source) throw new Error("Kildemappen er tom");

  const source = new LocalStorageDriver(options.source);
  const target = new S3StorageDriver(s3ConfigFromEnv());

  await target.healthCheck();
  await source.healthCheck();

  const objects = (await source.list())
    .filter((object) => options.includeInternal || !object.key.startsWith("."))
    .slice(0, options.limit ?? undefined);

  let copied = 0;
  let skipped = 0;
  let verified = 0;
  const failures: string[] = [];

  for (const object of objects) {
    try {
      const existing = await target.stat(object.key);
      if (existing && existing.size === object.size && !options.force) {
        if (options.verify) {
          const [left, right] = await Promise.all([
            source.read(object.key),
            target.read(object.key),
          ]);
          if (sha256(left) !== sha256(right)) {
            throw new Error("sjekksum avviker");
          }
          verified += 1;
        } else {
          skipped += 1;
        }
        continue;
      }
      if (options.check) {
        throw new Error(
          existing
            ? `målfilen har feil størrelse (${existing.size} != ${object.size})`
            : "målfilen mangler",
        );
      }
      if (options.dryRun) {
        console.log(`ville kopiert ${object.key} (${object.size} byte)`);
        copied += 1;
        continue;
      }

      const localPath = source.localPath(object.key);
      if (!localPath) throw new Error("klarte ikke å lese kilden");
      await target.writeFromFile(object.key, localPath, {
        contentType: contentTypeForKey(object.key),
        cacheControl: "private, no-store",
      });

      const written = await target.stat(object.key);
      if (!written || written.size !== object.size) {
        throw new Error("målfilen fikk feil størrelse etter skriving");
      }
      if (options.verify) {
        const [left, right] = await Promise.all([
          source.read(object.key),
          target.read(object.key),
        ]);
        if (sha256(left) !== sha256(right)) {
          throw new Error("sjekksum avviker etter skriving");
        }
        verified += 1;
      }
      copied += 1;
    } catch (error) {
      failures.push(
        `${object.key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        source: options.source,
        bucket: process.env.S3_BUCKET,
        prefix: process.env.S3_PREFIX ?? "",
        examined: objects.length,
        copied,
        skipped,
        verified,
        failed: failures.length,
        dryRun: options.dryRun,
        checkOnly: options.check,
      },
      null,
      2,
    ),
  );
  for (const failure of failures) console.error(`FEIL ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
