// i18n-ignore-file: revisjonshandlinger lagres som stabile norske data og
// oversettes ved visning i audit-actions.ts.
import prisma from "@/lib/prisma";
import { audit, auditRequestContext, auditStandalone, type AuditActor } from "@/lib/audit";
import { cleanText } from "@/lib/sanitize";
import {
  acceptTotpTimeStep,
  createTotpSecret,
  TWO_FACTOR_SETUP_TTL_MS,
  verifyTotpStep,
} from "@/lib/two-factor";
import { replaceRecoveryCodes } from "@/lib/two-factor-recovery";
import { clearCalendarToken } from "./calendar-feed";

/**
 * Oppsett av 2FA for en bruker som nettopp har verifisert passordet sitt, men
 * som ennå ikke har en sesjon fordi rollen krever 2FA.
 *
 * Funksjonene tar bare en bruker-id. Kallet må selv ha bevist at id-en kommer
 * fra en signert, kortlevd «venter på innlogging»-cookie. Det er derfor ingen
 * passordparameter her: passordet ble kontrollert rett før cookien ble laget.
 */

export type EnrollmentError =
  | "forbidden"
  | "not_required"
  | "already_enabled"
  | "setup_expired"
  | "invalid_code"
  | "server_error";

export type EnrollmentResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; reason: EnrollmentError };

type EnrollmentUser = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  isActive: boolean;
  isTwoFactorEnabled: boolean;
  departmentId: string | null;
};

function actorFor(user: EnrollmentUser): AuditActor {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    departmentId: user.departmentId,
  };
}

function isRecordNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2025",
  );
}

async function loadUser(userId: string): Promise<EnrollmentUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      isTwoFactorEnabled: true,
      departmentId: true,
    },
  });
}

/**
 * Starter oppsettet og lagrer en ventende hemmelighet. En eksisterende,
 * aktivert 2FA overskrives aldri.
 */
export async function startRequiredEnrollment(
  userId: string,
): Promise<EnrollmentResult> {
  const user = await loadUser(userId);
  if (!user?.isActive) return { ok: false, reason: "forbidden" };
  if (user.isTwoFactorEnabled) return { ok: false, reason: "already_enabled" };

  const secret = createTotpSecret();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id, isTwoFactorEnabled: false },
        data: {
          twoFactorSecret: secret,
          twoFactorSetupStartedAt: new Date(),
          lastTotpTimeStep: null,
          isTwoFactorEnabled: false,
        },
      });
      await audit(tx, {
        entityType: "User",
        entityId: user.id,
        action: "2FA: startet påkrevd oppsett",
        actionCode: "user.2fa.setup.started",
        retentionClass: "SECURITY_1Y",
        actor: actorFor(user),
      });
    });
  } catch (error) {
    if (isRecordNotFound(error)) return { ok: false, reason: "already_enabled" };
    return { ok: false, reason: "server_error" };
  }

  return { ok: true, data: undefined };
}

/**
 * Fullfører oppsettet. Ved suksess økes øktversjonen, gjenopprettingskoder
 * erstattes og kalenderabonnementet nullstilles i samme transaksjon.
 */
export async function confirmRequiredEnrollment(
  userId: string,
  rawCode: unknown,
): Promise<
  EnrollmentResult<{ sessionVersion: number; recoveryCodes: string[] }>
> {
  const user = await loadUser(userId);
  if (!user?.isActive) return { ok: false, reason: "forbidden" };
  if (user.isTwoFactorEnabled) return { ok: false, reason: "already_enabled" };

  const state = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      twoFactorSecret: true,
      twoFactorSetupStartedAt: true,
      lastTotpTimeStep: true,
    },
  });
  if (!state?.twoFactorSecret) return { ok: false, reason: "invalid_code" };

  const startedAt = state.twoFactorSetupStartedAt?.getTime() ?? 0;
  if (!startedAt || Date.now() - startedAt > TWO_FACTOR_SETUP_TTL_MS) {
    await prisma.$transaction(async (tx) => {
      try {
        await tx.user.update({
          where: {
            id: user.id,
            twoFactorSetupStartedAt: state.twoFactorSetupStartedAt,
          },
          data: { twoFactorSecret: null, twoFactorSetupStartedAt: null },
        });
      } catch (error) {
        if (!isRecordNotFound(error)) throw error;
      }
      await audit(tx, {
        entityType: "User",
        entityId: user.id,
        action: "2FA: oppsett utløpt",
        actionCode: "user.2fa.setup.expired",
        retentionClass: "SECURITY_1Y",
        actor: actorFor(user),
      });
    });
    return { ok: false, reason: "setup_expired" };
  }

  const code = cleanText(rawCode, { maxLength: 10 });
  const verification = verifyTotpStep(
    state.twoFactorSecret,
    code,
    state.lastTotpTimeStep,
  );
  if (!verification.valid) {
    try {
      // Feil engangskode i den påkrevde innloggingsflyten er en avvist
      // innlogging, ikke bare en feilet innstilling.
      await auditStandalone({
        entityType: "User",
        entityId: user.id,
        action: "2FA: feilet verifisering",
        actionCode: "auth.2fa.failed",
        outcome: "DENIED",
        retentionClass: "SECURITY_1Y",
        actor: actorFor(user),
        targetUserId: user.id,
        metadata: { step: "required_enrollment" },
        context: await auditRequestContext(),
      });
    } catch {
      // Revisjonslogging skal ikke endre svaret.
    }
    return { ok: false, reason: "invalid_code" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      if (!(await acceptTotpTimeStep(tx, user.id, verification.timeStep))) {
        return null;
      }
      const updated = await tx.user.update({
        where: { id: user.id, isTwoFactorEnabled: false },
        data: {
          isTwoFactorEnabled: true,
          twoFactorSetupStartedAt: null,
          sessionVersion: { increment: 1 },
        },
        select: { sessionVersion: true },
      });
      const recoveryCodes = await replaceRecoveryCodes(tx, user.id);
      await clearCalendarToken(user.id, tx);
      await audit(tx, {
        entityType: "User",
        entityId: user.id,
        action: "2FA: fullførte påkrevd oppsett",
        actionCode: "user.2fa.enrolled",
        retentionClass: "SECURITY_1Y",
        actor: actorFor(user),
      });
      return { sessionVersion: updated.sessionVersion, recoveryCodes };
    });

    if (!result) return { ok: false, reason: "invalid_code" };
    return { ok: true, data: result };
  } catch (error) {
    if (isRecordNotFound(error)) return { ok: false, reason: "already_enabled" };
    return { ok: false, reason: "server_error" };
  }
}
