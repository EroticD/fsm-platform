"use server";
// i18n-ignore-file: revisjonshandlinger lagres som stabile norske data og
// oversettes ved visning i audit-actions.ts.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import {
  auditRequestContext,
  auditStandalone,
  type AuditEntry,
} from "@/lib/audit";
import { verifyCredentials } from "@/lib/credentials";
import { verifyTotpStep, acceptTotpTimeStep } from "@/lib/two-factor";
import { consumeRecoveryCode } from "@/lib/two-factor-recovery";
import {
  clearPendingTwoFactor,
  createSessionCookie,
  readPendingTwoFactor,
  setPendingTwoFactor,
} from "@/lib/session-token";
import { allowRequestDb, resetRateLimitDb } from "@/lib/rate-limit-db";
import { safeLoginCallbackTarget } from "@/lib/safe-redirect";
import { isMobileUserAgent } from "@/lib/device";
import { homePathForRole } from "@/lib/navigation";
import { clientIpFrom } from "@/lib/client-ip";
import { cleanEmail } from "@/lib/sanitize";
import { logger } from "@/lib/logger";
import { requiresTwoFactorEnrollment } from "@/lib/two-factor-policy";

/**
 * Aktøren for hendelser der vi ikke vet hvem brukeren er – ukjent e-post, feil
 * passord eller en konto som ennå ikke er aktivert. Verken e-posten eller
 * passordet finnes i raden; bare at et forsøk ble avvist.
 */
const UNKNOWN_ACTOR = { id: "", name: null, email: null };

/**
 * Revisjonsrad for en innloggingshendelse.
 *
 * Logging skal aldri hindre selve innloggingen: feil svelges, og den rå
 * feilmeldingen logges aldri fordi raden kan inneholde brukerens e-post.
 * IP, brukeragent og request-id tas med fra forespørselen.
 */
async function auditAuth(entry: Omit<AuditEntry, "context">): Promise<void> {
  try {
    await auditStandalone({ ...entry, context: await auditRequestContext() });
  } catch {
    console.error("Kunne ikke skrive revisjonsrad for innlogging");
  }
}

/**
 * Logger inn uten JavaScript. Passordet sendes i selve forespørselen via en
 * server-action, så det havner aldri i adressefeltet. Hvis brukeren har slått
 * på to-trinns verifisering, sendes man videre til kode-steget.
 */
export async function loginAction(formData: FormData): Promise<never> {
  const email = cleanEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const callbackUrl = safeLoginCallbackTarget(
    typeof formData.get("callbackUrl") === "string"
      ? (formData.get("callbackUrl") as string)
      : null
  );
  // Skjemaet sender alltid med en skjult callbackUrl. Bare en faktisk
  // mellomlagret destinasjon skal overstyre rollens hjem.
  const hasExplicitCallback = callbackUrl !== "/";

  const fail = (error: string): string => {
    const params = new URLSearchParams({ error });
    if (callbackUrl !== "/") params.set("callbackUrl", callbackUrl);
    return `/logg-inn?${params.toString()}`;
  };

  const requestHeaders = await headers();
  // Bruk den felles, proxy-bevisste hjelperen. Uten TRUST_PROXY ignoreres
  // X-Forwarded-For, slik at en klient ikke kan omgå IP-sperren.
  const ip = clientIpFrom(requestHeaders);
  // Montører starter i feltportalen på mobil og på dashbordet på desktop.
  // En eksplisitt, trygg callback nedenfor overstyrer alltid dette.
  const mobile = isMobileUserAgent(requestHeaders.get("user-agent"));

  const result = await verifyCredentials(email, password, ip);
  if (result.status !== "ok") {
    // Strukturert hendelse for drift: ingen e-post eller passord logges.
    logger.warn("Innlogging avvist", {
      reason: result.status,
      ipKnown: Boolean(ip),
    });

    if (result.status === "locked") {
      await auditAuth({
        entityType: "User",
        entityId: "unknown",
        action: "Innlogging avvist: for mange forsøk",
        actionCode: "auth.login.locked",
        outcome: "DENIED",
        retentionClass: "SECURITY_1Y",
        actor: UNKNOWN_ACTOR,
        metadata: { reason: "locked", retryAfterSeconds: result.retryAfterSeconds },
      });
      redirect(fail("TooManyAttempts"));
    }

    const inactive = result.status === "inactive";
    await auditAuth({
      entityType: "User",
      entityId: "unknown",
      action: inactive
        ? "Innlogging avvist: kontoen er ikke aktivert"
        : "Innlogging avvist: feil legitimasjon",
      actionCode: inactive ? "auth.login.inactive" : "auth.login.failed",
      outcome: "DENIED",
      retentionClass: "SECURITY_1Y",
      actor: UNKNOWN_ACTOR,
      metadata: { reason: result.status },
    });
    redirect(fail(inactive ? "AccountNotActivated" : "CredentialsSignin"));
  }

  // Har brukeren to-trinns verifisering? Da må vi be om engangskoden før
  // sesjonen opprettes.
  const dbUser = await prisma.user.findUnique({
    where: { id: result.user.id },
    select: {
      isTwoFactorEnabled: true,
      twoFactorSecret: true,
      departmentId: true,
    },
  });
  const actor = {
    id: result.user.id,
    name: result.user.name,
    email: result.user.email,
  };
  const departmentId = dbUser?.departmentId ?? null;

  if (dbUser?.isTwoFactorEnabled && !dbUser.twoFactorSecret) {
    // Feilkonfigurert 2FA skal aldri falle tilbake til innlogging uten kode.
    redirect(fail("TwoFactorUnavailable"));
  }

  if (dbUser?.isTwoFactorEnabled) {
    await setPendingTwoFactor(result.user.id);
    const params = new URLSearchParams();
    if (callbackUrl !== "/") params.set("callbackUrl", callbackUrl);
    const qs = params.toString();
    redirect(`/logg-inn/2fa${qs ? `?${qs}` : ""}`);
  }

  // Privilegerte roller kan være pålagt 2FA. Da opprettes ingen sesjon før
  // brukeren har fullført oppsettet i enrollment-gaten. Den midlertidige
  // cookien beviser at passordet nettopp er verifisert.
  if (
    requiresTwoFactorEnrollment({
      role: result.user.role,
      isTwoFactorEnabled: dbUser?.isTwoFactorEnabled ?? false,
    })
  ) {
    await setPendingTwoFactor(result.user.id);
    await auditAuth({
      entityType: "User",
      entityId: result.user.id,
      action: "2FA: påkrevd oppsett startet",
      actionCode: "user.2fa.enrollment.required",
      outcome: "SUCCESS",
      retentionClass: "SECURITY_1Y",
      actor,
      departmentId,
      targetUserId: result.user.id,
      metadata: { reason: "policy" },
    });
    redirect("/logg-inn/2fa/oppsett");
  }

  await auditAuth({
    entityType: "User",
    entityId: result.user.id,
    action: "Logget inn",
    actionCode: "auth.login.success",
    outcome: "SUCCESS",
    retentionClass: "SECURITY_1Y",
    actor,
    departmentId,
    metadata: { method: "password" },
  });

  await createSessionCookie(result.user);
  redirect(
    hasExplicitCallback
      ? callbackUrl
      : homePathForRole(result.user.role, { mobile })
  );
}

/**
 * Verifiserer engangskoden i 2FA-steget og oppretter sesjonen.
 */
export async function verifyTwoFactorAction(formData: FormData): Promise<never> {
  const code = String(formData.get("code") ?? "");
  const callbackUrl = safeLoginCallbackTarget(
    typeof formData.get("callbackUrl") === "string"
      ? (formData.get("callbackUrl") as string)
      : null
  );
  const hasExplicitCallback = callbackUrl !== "/";
  const mobile = isMobileUserAgent((await headers()).get("user-agent"));

  const fail = (error: string): string => {
    const params = new URLSearchParams({ error });
    if (callbackUrl !== "/") params.set("callbackUrl", callbackUrl);
    return `/logg-inn/2fa?${params.toString()}`;
  };

  const userId = await readPendingTwoFactor();
  if (!userId) {
    redirect(fail("TwoFactorExpired"));
  }

  const rateLimitKey = `2fa:${userId}`;
  const limit = await allowRequestDb(rateLimitKey, 5, 15 * 60_000);
  if (!limit.allowed) {
    redirect(fail("TooManyAttempts"));
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      sessionVersion: true,
      isActive: true,
      isTwoFactorEnabled: true,
      twoFactorSecret: true,
      lastTotpTimeStep: true,
      departmentId: true,
    },
  });

  if (!user || !user.isActive || !user.isTwoFactorEnabled || !user.twoFactorSecret) {
    await clearPendingTwoFactor();
    redirect(fail("TwoFactorExpired"));
  }

  const actor = { id: user.id, name: user.name, email: user.email };

  const verification = verifyTotpStep(
    user.twoFactorSecret,
    code,
    user.lastTotpTimeStep,
  );
  if (!verification.valid) {
    await auditAuth({
      entityType: "User",
      entityId: user.id,
      action: "2FA: feilet verifisering",
      actionCode: "auth.2fa.failed",
      outcome: "DENIED",
      retentionClass: "SECURITY_1Y",
      actor,
      departmentId: user.departmentId,
      targetUserId: user.id,
      metadata: { method: "totp", step: "login" },
    });
    redirect(fail("InvalidTwoFactor"));
  }

  // Tidssteget lagres atomisk, slik at samme kode ikke kan brukes to ganger
  // selv om to forespørsler kommer samtidig.
  const accepted = await prisma.$transaction((tx) =>
    acceptTotpTimeStep(tx, user.id, verification.timeStep),
  );
  if (!accepted) {
    await auditAuth({
      entityType: "User",
      entityId: user.id,
      action: "2FA: feilet verifisering",
      actionCode: "auth.2fa.failed",
      outcome: "DENIED",
      retentionClass: "SECURITY_1Y",
      actor,
      departmentId: user.departmentId,
      targetUserId: user.id,
      metadata: { method: "totp", step: "login_replay" },
    });
    redirect(fail("InvalidTwoFactor"));
  }

  await auditAuth({
    entityType: "User",
    entityId: user.id,
    action: "Logget inn",
    actionCode: "auth.login.success",
    outcome: "SUCCESS",
    retentionClass: "SECURITY_1Y",
    actor,
    departmentId: user.departmentId,
    metadata: { method: "totp" },
  });

  await resetRateLimitDb(rateLimitKey);
  await clearPendingTwoFactor();
  await createSessionCookie({
    id: user.id,
    email: user.email ?? "",
    name: user.name,
    role: user.role,
    sessionVersion: user.sessionVersion,
  });

  redirect(
    hasExplicitCallback ? callbackUrl : homePathForRole(user.role, { mobile }),
  );
}

/**
 * Logger inn med en gjenopprettingskode når autentiseringsappen er utilgjengelig.
 * Koden brukes opp atomisk, og innloggingen fullføres på samme måte som TOTP.
 */
export async function verifyRecoveryCodeAction(
  formData: FormData,
): Promise<never> {
  const code = String(formData.get("recoveryCode") ?? "");
  const callbackUrl = safeLoginCallbackTarget(
    typeof formData.get("callbackUrl") === "string"
      ? (formData.get("callbackUrl") as string)
      : null,
  );
  const hasExplicitCallback = callbackUrl !== "/";
  const mobile = isMobileUserAgent((await headers()).get("user-agent"));

  const fail = (error: string, recovery = false): string => {
    const params = new URLSearchParams({ error });
    if (recovery) params.set("recovery", "1");
    if (callbackUrl !== "/") params.set("callbackUrl", callbackUrl);
    return `/logg-inn/2fa?${params.toString()}`;
  };

  const userId = await readPendingTwoFactor();
  if (!userId) {
    redirect(fail("TwoFactorExpired"));
  }

  const rateLimitKey = `2fa:${userId}`;
  const limit = await allowRequestDb(rateLimitKey, 5, 15 * 60_000);
  if (!limit.allowed) {
    redirect(fail("TooManyAttempts", true));
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      sessionVersion: true,
      isActive: true,
      isTwoFactorEnabled: true,
      twoFactorSecret: true,
      departmentId: true,
    },
  });

  if (!user || !user.isActive || !user.isTwoFactorEnabled || !user.twoFactorSecret) {
    await clearPendingTwoFactor();
    redirect(fail("TwoFactorExpired"));
  }

  const actor = { id: user.id, name: user.name, email: user.email };

  if (!(await consumeRecoveryCode(user.id, code))) {
    // Koden selv lagres aldri – bare at et forsøk ble avvist.
    await auditAuth({
      entityType: "User",
      entityId: user.id,
      action: "2FA: feilet gjenopprettingskode",
      actionCode: "auth.2fa.failed",
      outcome: "DENIED",
      retentionClass: "SECURITY_1Y",
      actor,
      departmentId: user.departmentId,
      targetUserId: user.id,
      metadata: { method: "recovery_code", step: "login" },
    });
    redirect(fail("InvalidRecoveryCode", true));
  }

  // Revisjonsloggen er best effort, som for vanlig innlogging. Koden selv
  // lagres aldri – bare at en gjenopprettingskode ble brukt.
  await auditAuth({
    entityType: "User",
    entityId: user.id,
    action: "Logget inn med gjenopprettingskode",
    actionCode: "auth.login.success",
    outcome: "SUCCESS",
    retentionClass: "SECURITY_1Y",
    actor,
    departmentId: user.departmentId,
    metadata: { method: "recovery_code" },
  });

  await resetRateLimitDb(rateLimitKey);
  await clearPendingTwoFactor();
  await createSessionCookie({
    id: user.id,
    email: user.email ?? "",
    name: user.name,
    role: user.role,
    sessionVersion: user.sessionVersion,
  });

  redirect(
    hasExplicitCallback ? callbackUrl : homePathForRole(user.role, { mobile }),
  );
}
