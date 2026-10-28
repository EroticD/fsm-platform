import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { allowRequestDb, resetRateLimitDb } from "@/lib/rate-limit-db";
import { cleanText } from "@/lib/sanitize";
import {
  createTotpSecret,
  TWO_FACTOR_SETUP_TTL_MS,
  verifyTotp,
} from "@/lib/two-factor";
import { replaceRecoveryCodes } from "@/lib/two-factor-recovery";
import { clearCalendarToken } from "./calendar-feed";
import { toAuditActor, type ServiceActor } from "./actor";

/** 2FA-innstillinger krever ny autentisering, med både bruker- og IP-grense. */
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const USER_RATE_LIMIT = 5;
const IP_RATE_LIMIT = 20;

/** Feilårsaker for 2FA-innstillingene. Ingen av dem bærer kode eller passord. */
export type SecurityError =
  | "forbidden"
  | "rate_limited"
  | "invalid_password"
  | "invalid_code"
  | "setup-expired";

export type SecurityResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; reason: SecurityError };

function securityOk<T>(data: T): SecurityResult<T> {
  return { ok: true, data };
}

function securityFail(reason: SecurityError): SecurityResult<never> {
  return { ok: false, reason };
}

function userRateLimitKey(userId: string): string {
  return `2fa-settings:user:${userId}`;
}

function ipRateLimitKey(ip: string): string {
  return `2fa-settings:ip:${ip}`;
}

/**
 * Sjekker både bruker- og IP-grensen. Telleren øker for hvert forsøk; den
 * nullstilles først når hele handlingen har lykkes. Da kan ikke en angriper
 * med riktig passord fortsette å gjette TOTP-koder uten å bli sperret.
 */
async function guardRateLimit(userId: string, ip?: string): Promise<boolean> {
  const userLimit = await allowRequestDb(
    userRateLimitKey(userId),
    USER_RATE_LIMIT,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!userLimit.allowed) return false;

  if (ip) {
    const ipLimit = await allowRequestDb(
      ipRateLimitKey(ip),
      IP_RATE_LIMIT,
      RATE_LIMIT_WINDOW_MS,
    );
    if (!ipLimit.allowed) return false;
  }

  return true;
}

async function resetRateLimit(userId: string, ip?: string): Promise<void> {
  await resetRateLimitDb(
    userRateLimitKey(userId),
    ...(ip ? [ipRateLimitKey(ip)] : []),
  );
}

/**
 * Revisjonslogger en mislykket 2FA-verifisering. `step` er en fast kode for
 * hvilket trinn som feilet – aldri selve TOTP-koden eller passordet.
 */
async function auditFailure(actor: ServiceActor, step: string): Promise<void> {
  await prisma.auditLog.create({
    data: {
      entityType: "User",
      entityId: actor.id,
      action: "2FA: feilet verifisering",
      userName: actor.name || actor.email || "Ukjent",
      actorId: actor.id || null,
      metadata: { step },
    },
  });
}

/**
 * Krever at innlogget bruker oppgir sitt eget passord på nytt. Brukes før
 * start, avbrytelse og deaktivering av 2FA, slik at en kapret økt ikke kan
 * endre sikkerhetsinnstillingene uten passordet. Hvert forsøk rate-limites.
 */
export async function verifyOwnPassword(
  actor: ServiceActor,
  passwordInput: unknown,
  ip?: string,
): Promise<SecurityResult> {
  if (!actor.isActive) return securityFail("forbidden");

  if (!(await guardRateLimit(actor.id, ip))) {
    return securityFail("rate_limited");
  }

  const password = String(passwordInput ?? "");
  if (!password) {
    await auditFailure(actor, "password");
    return securityFail("invalid_password");
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { password: true },
  });

  if (!dbUser?.password || !(await bcrypt.compare(password, dbUser.password))) {
    await auditFailure(actor, "password");
    return securityFail("invalid_password");
  }

  return securityOk(undefined);
}

/** Prisma-feilkode for «raden finnes ikke / matcher ikke lenger». */
function isRecordNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2025",
  );
}

/** Starter oppsett av 2FA med en ny, ennå ikke aktivert hemmelighet. */
export async function startTwoFactorSetup(
  actor: ServiceActor,
  input: { password?: unknown },
  ip?: string,
): Promise<SecurityResult> {
  const verified = await verifyOwnPassword(actor, input.password, ip);
  if (!verified.ok) return verified;

  // Et pågående oppsett skal aldri kunne overskrive en aktivert 2FA: ellers
  // ville en kapret økt med passord kunne skru av det andre faktorleddet.
  const state = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { isTwoFactorEnabled: true },
  });
  if (state?.isTwoFactorEnabled) return securityFail("forbidden");

  const secret = createTotpSecret();

  try {
    await prisma.$transaction(async (tx) => {
      // Betingelsen ligger i selve skrivingen, ikke bare i forhåndssjekken:
      // aktiveres 2FA mellom lesingen og skrivingen, matcher ikke raden og
      // hele transaksjonen rulles tilbake.
      await tx.user.update({
        where: { id: actor.id, isTwoFactorEnabled: false },
        data: {
          twoFactorSecret: secret,
          twoFactorSetupStartedAt: new Date(),
          isTwoFactorEnabled: false,
        },
      });
      await audit(tx, {
        entityType: "User",
        entityId: actor.id,
        action: "Startet oppsett av to-trinns verifisering",
        actor: toAuditActor(actor),
      });
    });
  } catch (error) {
    if (isRecordNotFound(error)) return securityFail("forbidden");
    throw error;
  }

  await resetRateLimit(actor.id, ip);
  return securityOk(undefined);
}

/**
 * Aktiverer 2FA når både passordet og engangskoden stemmer, og oppsettet ikke
 * er utløpt. Øktversjonen økes i samme transaksjon som endringen og
 * revisjonsloggen, slik at alle andre økter blir ugyldige umiddelbart.
 */
export async function confirmTwoFactorSetup(
  actor: ServiceActor,
  input: { password?: unknown; code?: unknown },
  ip?: string,
): Promise<SecurityResult<{ sessionVersion: number; recoveryCodes: string[] }>> {
  // Passordet kreves på nytt, slik at en kapret økt alene ikke kan fullføre
  // et oppsett. verifyOwnPassword tar også rate-limit-telleren for forsøket.
  const verified = await verifyOwnPassword(actor, input.password, ip);
  if (!verified.ok) return verified;

  const code = cleanText(input.code, { maxLength: 10 });
  const dbUser = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { twoFactorSecret: true, twoFactorSetupStartedAt: true },
  });

  if (!dbUser?.twoFactorSecret) {
    await auditFailure(actor, "totp_confirm");
    return securityFail("invalid_code");
  }

  const startedAt = dbUser.twoFactorSetupStartedAt?.getTime() ?? 0;
  if (!startedAt || Date.now() - startedAt > TWO_FACTOR_SETUP_TTL_MS) {
    // Et utløpt oppsett skal ikke kunne fullføres senere. Slett den ventende
    // hemmeligheten betinget, slik at et samtidig nytt oppsett ikke røres.
    await prisma.$transaction(async (tx) => {
      try {
        await tx.user.update({
          where: {
            id: actor.id,
            twoFactorSetupStartedAt: dbUser.twoFactorSetupStartedAt,
          },
          data: { twoFactorSecret: null, twoFactorSetupStartedAt: null },
        });
      } catch (error) {
        if (!isRecordNotFound(error)) throw error;
      }
      await audit(tx, {
        entityType: "User",
        entityId: actor.id,
        action: "2FA: oppsett utløpt",
        actor: toAuditActor(actor),
      });
    });
    return securityFail("setup-expired");
  }

  if (!verifyTotp(dbUser.twoFactorSecret, code)) {
    await auditFailure(actor, "totp_confirm");
    return securityFail("invalid_code");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: actor.id },
      data: {
        isTwoFactorEnabled: true,
        twoFactorSetupStartedAt: null,
        sessionVersion: { increment: 1 },
      },
      select: { sessionVersion: true },
    });
    // Kodene lages i samme transaksjon: 2FA kan aldri bli stående aktivert
    // uten at brukeren har fått et komplett sett gjenopprettingskoder.
    const recoveryCodes = await replaceRecoveryCodes(tx, actor.id);
    await clearCalendarToken(actor.id, tx);
    await audit(tx, {
      entityType: "User",
      entityId: actor.id,
      action: "Slå på to-trinns verifisering",
      actor: toAuditActor(actor),
    });
    return { user, recoveryCodes };
  });

  await resetRateLimit(actor.id, ip);
  return securityOk({
    sessionVersion: updated.user.sessionVersion,
    recoveryCodes: updated.recoveryCodes,
  });
}

/** Avbryter et påbegynt 2FA-oppsett og ugyldiggjør eksisterende økter. */
export async function cancelTwoFactorSetup(
  actor: ServiceActor,
  input: { password?: unknown },
  ip?: string,
): Promise<SecurityResult<{ sessionVersion: number }>> {
  const verified = await verifyOwnPassword(actor, input.password, ip);
  if (!verified.ok) return verified;

  // Avbrytelse gjelder bare et påbegynt oppsett. En aktivert 2FA må slås av
  // gjennom disableTwoFactor, som også krever en gyldig TOTP-kode.
  const state = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { isTwoFactorEnabled: true },
  });
  if (state?.isTwoFactorEnabled) return securityFail("forbidden");

  let updated: { sessionVersion: number };
  try {
    updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        // Samme atomiske vern som i start: en samtidig aktivering skal ikke
        // kunne avbrytes med bare passord.
        where: { id: actor.id, isTwoFactorEnabled: false },
        data: {
          twoFactorSecret: null,
          twoFactorSetupStartedAt: null,
          isTwoFactorEnabled: false,
          sessionVersion: { increment: 1 },
        },
        select: { sessionVersion: true },
      });
      await clearCalendarToken(actor.id, tx);
      await audit(tx, {
        entityType: "User",
        entityId: actor.id,
        action: "Avbrøt oppsett av to-trinns verifisering",
        actor: toAuditActor(actor),
      });
      return user;
    });
  } catch (error) {
    if (isRecordNotFound(error)) return securityFail("forbidden");
    throw error;
  }

  await resetRateLimit(actor.id, ip);
  return securityOk({ sessionVersion: updated.sessionVersion });
}

/**
 * Slår av 2FA. Krever BÅDE nåværende passord og en gyldig engangskode, slik
 * at en kapret økt alene ikke kan fjerne det andre faktorleddet.
 */
export async function disableTwoFactor(
  actor: ServiceActor,
  input: { password?: unknown; code?: unknown },
  ip?: string,
): Promise<SecurityResult<{ sessionVersion: number }>> {
  const verified = await verifyOwnPassword(actor, input.password, ip);
  if (!verified.ok) return verified;

  const code = cleanText(input.code, { maxLength: 10 });
  const dbUser = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { twoFactorSecret: true, isTwoFactorEnabled: true },
  });

  if (
    !dbUser?.isTwoFactorEnabled ||
    !dbUser.twoFactorSecret ||
    !verifyTotp(dbUser.twoFactorSecret, code)
  ) {
    await auditFailure(actor, "totp_disable");
    return securityFail("invalid_code");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: actor.id },
      data: {
        isTwoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorSetupStartedAt: null,
        sessionVersion: { increment: 1 },
      },
      select: { sessionVersion: true },
    });
    // Gjenopprettingskoder skal aldri overleve at 2FA slås av.
    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: actor.id } });
    await clearCalendarToken(actor.id, tx);
    await audit(tx, {
      entityType: "User",
      entityId: actor.id,
      action: "Slå av to-trinns verifisering",
      actor: toAuditActor(actor),
    });
    return user;
  });

  await resetRateLimit(actor.id, ip);
  return securityOk({ sessionVersion: updated.sessionVersion });
}

/**
 * Lager et nytt sett gjenopprettingskoder. Krever både passord og en gyldig
 * engangskode, og erstatter alle gamle koder i samme transaksjon, slik at
 * ingen gamle koder blir gyldige.
 */
export async function regenerateRecoveryCodes(
  actor: ServiceActor,
  input: { password?: unknown; code?: unknown },
  ip?: string,
): Promise<SecurityResult<{ recoveryCodes: string[] }>> {
  const verified = await verifyOwnPassword(actor, input.password, ip);
  if (!verified.ok) return verified;

  // Nye koder gir bare mening når 2FA faktisk er aktivert.
  const state = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { isTwoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!state?.isTwoFactorEnabled || !state.twoFactorSecret) {
    return securityFail("forbidden");
  }

  const code = cleanText(input.code, { maxLength: 10 });
  if (!verifyTotp(state.twoFactorSecret, code)) {
    await auditFailure(actor, "totp_recovery_codes");
    return securityFail("invalid_code");
  }

  const recoveryCodes = await prisma.$transaction(async (tx) => {
    const codes = await replaceRecoveryCodes(tx, actor.id);
    await audit(tx, {
      entityType: "User",
      entityId: actor.id,
      action: "Genererte nye gjenopprettingskoder for to-trinns verifisering",
      actor: toAuditActor(actor),
    });
    return codes;
  });

  await resetRateLimit(actor.id, ip);
  return securityOk({ recoveryCodes });
}
