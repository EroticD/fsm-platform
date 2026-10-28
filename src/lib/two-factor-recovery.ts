import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export const RECOVERY_CODE_COUNT = 10;
/** Uten 0/O og 1/I, slik at kodene er enkle å skrive av fra papir. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const BCRYPT_ROUNDS = 10;

type RecoveryCodeWriter = Pick<
  Prisma.TransactionClient,
  "twoFactorRecoveryCode"
>;

/** Lager én kryptografisk tilfeldig kode på formen XXXX-XXXX. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    // 32 tegn i alfabetet gjør maskering med 31 helt jevnt fordelt.
    code += CODE_ALPHABET[bytes[index] & 31];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Lager et sett unike koder. */
export function generateRecoveryCodes(
  count = RECOVERY_CODE_COUNT,
): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/**
 * Normaliserer brukerens inntasting (små bokstaver, mellomrom og manglende
 * bindestrek er greit) og avviser alt som ikke er en gyldig kode.
 */
export function normalizeRecoveryCode(raw: unknown): string | null {
  const compact = String(raw ?? "")
    .toUpperCase()
    .replace(/[\s-]+/g, "");
  if (compact.length !== CODE_LENGTH) return null;
  for (const character of compact) {
    if (!CODE_ALPHABET.includes(character)) return null;
  }
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export async function hashRecoveryCode(
  code: string,
  rounds = BCRYPT_ROUNDS,
): Promise<string> {
  return bcrypt.hash(code, rounds);
}

/** Sammenligner en inntastet kode med en lagret bcrypt-hash. */
export async function verifyRecoveryCodeHash(
  rawCode: unknown,
  codeHash: string,
): Promise<boolean> {
  const code = normalizeRecoveryCode(rawCode);
  if (!code) return false;
  try {
    return await bcrypt.compare(code, codeHash);
  } catch {
    return false;
  }
}

/**
 * Erstatter alle kodene til en bruker. Kalles bare ved aktivering eller når
 * brukeren selv ber om nye koder. Returnerer klartekstkodene til engangsvisning;
 * databasen får bare hashene.
 */
export async function replaceRecoveryCodes(
  tx: RecoveryCodeWriter,
  userId: string,
): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map((code) => hashRecoveryCode(code)));

  await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
  await tx.twoFactorRecoveryCode.createMany({
    data: hashes.map((codeHash) => ({ userId, codeHash })),
  });

  return codes;
}

/**
 * Bruker opp en gjenopprettingskode. Selve oppdateringen krever `usedAt: null`,
 * så to samtidige innlogginger med samme kode ikke kan lykkes begge.
 */
export async function consumeRecoveryCode(
  userId: string,
  rawCode: unknown,
): Promise<boolean> {
  const code = normalizeRecoveryCode(rawCode);
  if (!code) return false;

  const candidates = await prisma.twoFactorRecoveryCode.findMany({
    where: { userId, usedAt: null },
    select: { id: true, codeHash: true },
  });

  let matchedId: string | null = null;
  for (const candidate of candidates) {
    try {
      if (await bcrypt.compare(code, candidate.codeHash)) {
        matchedId = candidate.id;
      }
    } catch {
      // En korrupt hash skal ikke stoppe andre gyldige koder.
    }
  }
  if (!matchedId) return false;

  const result = await prisma.twoFactorRecoveryCode.updateMany({
    where: { id: matchedId, userId, usedAt: null },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
}
