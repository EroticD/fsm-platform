// i18n-ignore-file: hash-kjeden beskriver lagrede revisjonsdata, ikke UI-tekst.
import { createHash } from "node:crypto";

/**
 * Hash-kjede for revisjonsloggen.
 *
 * Hver rad har `hash` = SHA-256 av en kanonisk beskrivelse av radens innhold og
 * `prevHash` = forrige rads hash. Endres én rad – eller en rad fjernes uten at
 * hash-verdien registreres som purret – vil verifiseringen oppdage det.
 *
 * Funksjonene her er rene og brukes både av skriveveien (`src/lib/audit.ts`),
 * retensjonsjobben, eksporten og backfill-skriptet. Da finnes det bare én
 * definisjon av hva som hashes.
 */

/** Felt som inngår i hashen. `metadata` er vilkårlig JSON. */
export type AuditHashFields = {
  entityType: string;
  entityId: string;
  action: string;
  userName: string;
  actorId: string | null;
  departmentId: string | null;
  metadata: unknown;
  createdAt: Date | string;
};

/** En lagret revisjonsrad, slik verifiseringen og backfill leser den. */
export type AuditChainRow = AuditHashFields & {
  id: string;
  seq: number;
  prevHash: string | null;
  hash: string | null;
};

export type AuditChainVerification = {
  ok: boolean;
  checked: number;
  /** Første og siste hash i det kontrollerte utsnittet. */
  firstHash: string | null;
  lastHash: string | null;
  /** Raden der kjeden eventuelt brytes. */
  brokenAt: { id: string; seq: number; reason: string } | null;
  /** Hvor mange kontrollerte hull som skyldes purring. */
  purgedGaps: number;
};

/**
 * JSON med sorterte nøkler og stabile verdier. `JSON.stringify` alene er ikke
 * deterministisk for objekter: rekkefølgen på nøklene følger innsettings-
 * rekkefølgen, og to ellers like logger ville fått ulik hash etter en
 * serialiseringsrunde.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = canonicalValue(child);
    }
    return result;
  }
  return value;
}

function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Ugyldig tidspunkt i revisjonsloggen");
  }
  return date.toISOString();
}

/** Kanonisk beskrivelse som hashen bygges fra. */
export function canonicalAuditEntry(
  entry: AuditHashFields,
  prevHash: string | null,
): Record<string, unknown> {
  return {
    version: 1,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    userName: entry.userName,
    actorId: entry.actorId ?? null,
    departmentId: entry.departmentId ?? null,
    metadata: canonicalValue(entry.metadata ?? null),
    createdAt: isoDate(entry.createdAt),
    prevHash,
  };
}

/** SHA-256 for én rad, gitt forrige hash. */
export function computeAuditHash(
  entry: AuditHashFields,
  prevHash: string | null,
): string {
  return createHash("sha256")
    .update(stableJson(canonicalAuditEntry(entry, prevHash)))
    .digest("hex");
}

/** Hash-verdiene som faktisk lagres på raden. */
export function auditHashesForRow(
  entry: AuditHashFields,
  prevHash: string | null,
): { prevHash: string | null; hash: string } {
  return { prevHash, hash: computeAuditHash(entry, prevHash) };
}

function safeMetadata(value: unknown): unknown {
  // Prisma returnerer JsonValue. `canonicalValue` håndterer arrays/objekter.
  return value ?? null;
}

export type VerifyAuditChainOptions = {
  /** Hash-verdier som er fjernet av retensjonsjobben med vilje. */
  purgedHashes?: ReadonlySet<string> | readonly string[];
  /**
   * Når utsnittet starter midt i kjeden (f.eks. en filtrert eksport), er den
   * første radens `prevHash` et anker utenfor utsnittet. Verifiseringen
   * kontrollerer da at ankeret er oppgitt, men kan ikke slå opp raden.
   */
  allowFirstAnchor?: boolean;
};

/**
 * Verifiserer en sammenhengende mengde rader sortert stigende på `seq`.
 *
 * Et kontrollert hull (purret rad) godtas bare når den forventede forrige
 * hashen står i `purgedHashes`. En slettet rad uten tombstone gir derfor
 * `prevHash`-brudd, mens en endret rad gir hash-brudd.
 */
export function verifyAuditChain(
  rows: readonly AuditChainRow[],
  options: VerifyAuditChainOptions = {},
): AuditChainVerification {
  const purged =
    options.purgedHashes instanceof Set
      ? options.purgedHashes
      : new Set(options.purgedHashes ?? []);
  let previousHash: string | null = null;
  let checked = 0;
  let purgedGaps = 0;
  let firstHash: string | null = null;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.hash === null || row.hash === undefined) {
      return {
        ok: false,
        checked,
        firstHash,
        lastHash: previousHash,
        brokenAt: {
          id: row.id,
          seq: row.seq,
          reason: "missing_hash",
        },
        purgedGaps,
      };
    }

    const firstIsPurgedAnchor =
      index === 0 && row.prevHash !== null && purged.has(row.prevHash);
    const expectedPrev =
      index === 0
        ? options.allowFirstAnchor || firstIsPurgedAnchor
          ? row.prevHash
          : null
        : previousHash;

    if (index === 0 && !options.allowFirstAnchor && row.prevHash !== null) {
      if (firstIsPurgedAnchor) {
        // Starten på det som er igjen peker på en rad retensjonsjobben har
        // fjernet med vilje. Det er et kontrollert hull, ikke manipulering.
        purgedGaps += 1;
      } else {
        // Første rad i et helt utsnitt skal være starten på kjeden. Er den
        // ikke det, er enten rader fjernet eller utsnittet feil avgrenset.
        return {
          ok: false,
          checked,
          firstHash,
          lastHash: previousHash,
          brokenAt: {
            id: row.id,
            seq: row.seq,
            reason: "unexpected_chain_start",
          },
          purgedGaps,
        };
      }
    }

    if (row.prevHash !== expectedPrev) {
      if (row.prevHash !== null && purged.has(row.prevHash)) {
        purgedGaps += 1;
      } else {
        return {
          ok: false,
          checked,
          firstHash,
          lastHash: previousHash,
          brokenAt: {
            id: row.id,
            seq: row.seq,
            reason: "prev_hash_mismatch",
          },
          purgedGaps,
        };
      }
    }

    const recomputed = computeAuditHash(
      {
        entityType: row.entityType,
        entityId: row.entityId,
        action: row.action,
        userName: row.userName,
        actorId: row.actorId ?? null,
        departmentId: row.departmentId ?? null,
        metadata: safeMetadata(row.metadata),
        createdAt: row.createdAt,
      },
      row.prevHash,
    );

    if (recomputed !== row.hash) {
      return {
        ok: false,
        checked: checked + 1,
        firstHash: firstHash ?? row.hash,
        lastHash: previousHash,
        brokenAt: {
          id: row.id,
          seq: row.seq,
          reason: "hash_mismatch",
        },
        purgedGaps,
      };
    }

    checked += 1;
    firstHash ??= row.hash;
    previousHash = row.hash;
  }

  return {
    ok: true,
    checked,
    firstHash,
    lastHash: previousHash,
    brokenAt: null,
    purgedGaps,
  };
}

export type AuditBackfillClient = {
  auditLog: {
    findMany(args: {
      where?: { hash: null };
      orderBy: { seq: "asc" };
      take: number;
      cursor?: { seq: number };
      skip?: number;
      select: {
        id: true;
        seq: true;
        entityType: true;
        entityId: true;
        action: true;
        userName: true;
        actorId: true;
        departmentId: true;
        metadata: true;
        prevHash: true;
        hash: true;
        createdAt: true;
      };
    }): Promise<AuditChainRow[]>;
    update(args: {
      where: { id: string };
      data: { prevHash: string | null; hash: string };
    }): Promise<unknown>;
  };
};

export type AuditBackfillResult =
  | { ok: true; updated: number; checked: number; lastHash: string | null }
  | { ok: false; updated: number; checked: number; reason: string };

/**
 * Backfyller deterministisk hash-kjeden for rader som mangler hash.
 *
 * Radene leses i `seq`-rekkefølge, som er den samme rekkefølgen skriveveien
 * bruker. Skriptet er idempotent: rader som allerede har hash hoppes over, men
 * inngår som `prevHash` for neste rad. Eksisterende hasher kontrolleres mot
 * innholdet; stemmer de ikke, avbrytes backfillen i stedet for å skrive en
 * ødelagt kjede.
 */
export async function backfillAuditChain(
  client: AuditBackfillClient,
  options: { batchSize?: number; maxRows?: number } = {},
): Promise<AuditBackfillResult> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 500, 5_000));
  const maxRows = Math.max(1, options.maxRows ?? 1_000_000);
  let updated = 0;
  let checked = 0;
  let previousHash: string | null = null;
  let lastSeq: number | null = null;

  for (;;) {
    const batch = await client.auditLog.findMany({
      orderBy: { seq: "asc" },
      take: batchSize,
      ...(lastSeq === null
        ? {}
        : { cursor: { seq: lastSeq }, skip: 1 }),
      select: {
        id: true,
        seq: true,
        entityType: true,
        entityId: true,
        action: true,
        userName: true,
        actorId: true,
        departmentId: true,
        metadata: true,
        prevHash: true,
        hash: true,
        createdAt: true,
      },
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      checked += 1;
      if (checked > maxRows) {
        return {
          ok: false,
          updated,
          checked: checked - 1,
          reason: "too_many_rows",
        };
      }

      if (row.hash) {
        // Kjeden må allerede stemme fram til denne raden. Da kan en ny
        // kjøring trygt fortsette der den forrige slapp.
        if (row.prevHash !== previousHash) {
          return {
            ok: false,
            updated,
            checked,
            reason: `prev_hash_mismatch:${row.id}`,
          };
        }
        const expected = computeAuditHash(
          { ...row, metadata: safeMetadata(row.metadata) },
          row.prevHash,
        );
        if (expected !== row.hash) {
          return {
            ok: false,
            updated,
            checked,
            reason: `hash_mismatch:${row.id}`,
          };
        }
        previousHash = row.hash;
      } else {
        const hashes = auditHashesForRow(
          { ...row, metadata: safeMetadata(row.metadata) },
          previousHash,
        );
        await client.auditLog.update({
          where: { id: row.id },
          data: hashes,
        });
        updated += 1;
        previousHash = hashes.hash;
      }
    }

    lastSeq = batch[batch.length - 1].seq;
    if (batch.length < batchSize) break;
  }

  return { ok: true, updated, checked, lastHash: previousHash };
}
