"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { verifyCredentials } from "@/lib/credentials";
import { verifyTotp } from "@/lib/two-factor";
import {
  clearPendingTwoFactor,
  createSessionCookie,
  readPendingTwoFactor,
  setPendingTwoFactor,
} from "@/lib/session-token";
import { allowRequestDb, resetRateLimitDb } from "@/lib/rate-limit-db";
import { safeRelativeTarget } from "@/lib/safe-redirect";
import { clientIpFrom } from "@/lib/client-ip";
import { logger } from "@/lib/logger";

/**
 * Logger inn uten JavaScript. Passordet sendes i selve forespørselen via en
 * server-action, så det havner aldri i adressefeltet. Hvis brukeren har slått
 * på to-trinns verifisering, sendes man videre til kode-steget.
 */
export async function loginAction(formData: FormData): Promise<never> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = safeRelativeTarget(
    typeof formData.get("callbackUrl") === "string"
      ? (formData.get("callbackUrl") as string)
      : null
  );

  const fail = (error: string): string => {
    const params = new URLSearchParams({ error });
    if (callbackUrl !== "/") params.set("callbackUrl", callbackUrl);
    return `/logg-inn?${params.toString()}`;
  };

  const requestHeaders = await headers();
  // Bruk den felles, proxy-bevisste hjelperen. Uten TRUST_PROXY ignoreres
  // X-Forwarded-For, slik at en klient ikke kan omgå IP-sperren.
  const ip = clientIpFrom(requestHeaders);

  const result = await verifyCredentials(email, password, ip);
  if (result.status !== "ok") {
    // Strukturert hendelse for drift: ingen e-post eller passord logges.
    logger.warn("Innlogging avvist", {
      reason: result.status,
      ipKnown: Boolean(ip),
    });
    if (result.status === "locked") {
      redirect(fail("TooManyAttempts"));
    }
    redirect(
      fail(result.status === "inactive" ? "AccountNotActivated" : "CredentialsSignin")
    );
  }

  // Har brukeren to-trinns verifisering? Da må vi be om engangskoden før
  // sesjonen opprettes.
  const dbUser = await prisma.user.findUnique({
    where: { id: result.user.id },
    select: { isTwoFactorEnabled: true, twoFactorSecret: true },
  });

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

  // Innlogging logges best effort. En feil her skal aldri hindre innlogging.
  try {
    await prisma.auditLog.create({
      data: {
        entityType: "User",
        entityId: result.user.id,
        action: "Logget inn",
        userName: result.user.name || result.user.email || "Ukjent",
        actorId: result.user.id,
      },
    });
  } catch {
    // Revisjonsraden kan inneholde brukerens e-post som userName. Logg derfor
    // aldri den rå feilen.
    console.error("Kunne ikke logge innloggingen");
  }

  await createSessionCookie(result.user);
  redirect(callbackUrl);
}

/**
 * Verifiserer engangskoden i 2FA-steget og oppretter sesjonen.
 */
export async function verifyTwoFactorAction(formData: FormData): Promise<never> {
  const code = String(formData.get("code") ?? "");
  const callbackUrl = safeRelativeTarget(
    typeof formData.get("callbackUrl") === "string"
      ? (formData.get("callbackUrl") as string)
      : null
  );

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
    },
  });

  if (!user || !user.isActive || !user.isTwoFactorEnabled || !user.twoFactorSecret) {
    await clearPendingTwoFactor();
    redirect(fail("TwoFactorExpired"));
  }

  if (!verifyTotp(user.twoFactorSecret, code)) {
    redirect(fail("InvalidTwoFactor"));
  }

  await resetRateLimitDb(rateLimitKey);
  await clearPendingTwoFactor();
  await createSessionCookie({
    id: user.id,
    email: user.email ?? "",
    name: user.name,
    role: user.role,
    sessionVersion: user.sessionVersion,
  });

  redirect(callbackUrl);
}
