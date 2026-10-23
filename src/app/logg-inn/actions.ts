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
import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from "@/lib/rate-limit";

/**
 * Godtar både relative stier ("/kunder") og absolutte URL-er
 * ("http://10.0.0.115:3000/kunder"), og returnerer alltid en trygg, relativ
 * sti. Da kan vi aldri sende brukeren til et annet domene etter innlogging.
 */
function safeRelativeTarget(value: string | null): string {
  if (!value) return "/";
  try {
    const url = new URL(value, "http://relative.invalid");
    if (url.protocol !== "http:" && url.protocol !== "https:") return "/";
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "/";
  }
}

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
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    undefined;

  const result = await verifyCredentials(email, password, ip);
  if (result.status !== "ok") {
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

  if (dbUser?.isTwoFactorEnabled && dbUser.twoFactorSecret) {
    await setPendingTwoFactor(result.user.id);
    const params = new URLSearchParams();
    if (callbackUrl !== "/") params.set("callbackUrl", callbackUrl);
    const qs = params.toString();
    redirect(`/logg-inn/2fa${qs ? `?${qs}` : ""}`);
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

  const keys = [`2fa:${userId}`];
  const limit = checkLoginRateLimit(keys);
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
    recordLoginFailure(keys[0], 5);
    redirect(fail("InvalidTwoFactor"));
  }

  clearLoginFailures(keys);
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
