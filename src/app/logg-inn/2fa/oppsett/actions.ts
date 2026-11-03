"use server";
// i18n-ignore-file: revisjonshandlinger lagres som stabile norske data og
// oversettes ved visning i audit-actions.ts.

import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import {
  clearPendingTwoFactor,
  createSessionCookie,
  readPendingTwoFactor,
  setRecoveryCodesForDisplay,
} from "@/lib/session-token";
import { allowRequestDb } from "@/lib/rate-limit-db";
import {
  confirmRequiredEnrollment,
  startRequiredEnrollment,
} from "@/server/two-factor-enrollment";

const BASE = "/logg-inn/2fa/oppsett";

function fail(error: string): never {
  redirect(`${BASE}?error=${encodeURIComponent(error)}`);
}

function pendingUserIdOrFail(): Promise<string> {
  return readPendingTwoFactor().then((id) => (id ? id : fail("expired")));
}

/** Starter oppsettet for en bruker som er pålagt 2FA ved innlogging. */
export async function startRequiredEnrollmentAction(): Promise<never> {
  const userId = await pendingUserIdOrFail();
  const result = await startRequiredEnrollment(userId);
  if (!result.ok) {
    if (result.reason === "already_enabled") {
      redirect("/logg-inn/2fa");
    }
    fail(result.reason);
  }
  redirect(`${BASE}?startet=1`);
}

/**
 * Bekrefter engangskoden og oppretter først nå en vanlig sesjon. Den
 * midlertidige «venter på 2FA»-cookien fjernes etterpå.
 */
export async function confirmRequiredEnrollmentAction(
  formData: FormData,
): Promise<never> {
  const userId = await pendingUserIdOrFail();

  const limit = await allowRequestDb(
    `2fa-required:${userId}`,
    5,
    15 * 60_000,
  );
  if (!limit.allowed) fail("TooManyAttempts");

  const result = await confirmRequiredEnrollment(userId, formData.get("code"));
  if (!result.ok) {
    if (result.reason === "already_enabled") {
      redirect("/logg-inn/2fa");
    }
    fail(result.reason);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      sessionVersion: true,
    },
  });
  if (!user?.isActive) {
    await clearPendingTwoFactor();
    fail("forbidden");
  }

  await createSessionCookie({
    id: user.id,
    email: user.email ?? "",
    name: user.name,
    role: user.role,
    sessionVersion: user.sessionVersion,
  });
  await setRecoveryCodesForDisplay(user.id, result.data.recoveryCodes);
  await clearPendingTwoFactor();

  try {
    await prisma.auditLog.create({
      data: {
        entityType: "User",
        entityId: user.id,
        action: "Logget inn med påkrevd 2FA",
        userName: user.name || user.email || "Ukjent",
        actorId: user.id,
      },
    });
  } catch {
    // Revisjonslogging skal ikke hindre innloggingen.
  }

  redirect("/innstillinger?tab=sikkerhet&ok=enabled");
}
