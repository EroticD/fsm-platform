"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, refreshSessionCookie } from "@/lib/session";
import { clientIpFrom } from "@/lib/client-ip";
import {
  cancelTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
} from "@/server/security";
import {
  clearRecoveryCodesForDisplay,
  setRecoveryCodesForDisplay,
} from "@/lib/session-token";

const BASE = "/innstillinger?tab=sikkerhet";

/** Klient-IP bak reverse proxy, brukt som ekstra rate-limit-nøkkel. */
async function requestIp(): Promise<string | undefined> {
  // Uten en betrodd proxy kan en klient sette X-Forwarded-For fritt. Da er
  // IP-nøkkelen meningsløs; brukergrensen gjelder fortsatt.
  const requestHeaders = await headers();
  return clientIpFrom(requestHeaders);
}

async function currentActor() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/");
  return actor;
}

export async function startSetupAction(formData: FormData): Promise<never> {
  const actor = await currentActor();
  const result = await startTwoFactorSetup(
    actor,
    { password: formData.get("password") },
    await requestIp(),
  );

  if (!result.ok) {
    redirect(`${BASE}&error=passord`);
  }

  revalidatePath("/innstillinger");
  redirect(`${BASE}&setup=1`);
}

export async function confirmSetupAction(formData: FormData): Promise<never> {
  const actor = await currentActor();
  const result = await confirmTwoFactorSetup(
    actor,
    { code: formData.get("code") },
    await requestIp(),
  );

  if (!result.ok) {
    redirect(`${BASE}&setup=1&error=kode`);
  }

  // Andre økter er nå ugyldige; den som aktiverte 2FA skal fortsatt være innlogget.
  await refreshSessionCookie(actor.id, result.data.sessionVersion);
  await setRecoveryCodesForDisplay(result.data.recoveryCodes);
  revalidatePath("/innstillinger");
  redirect(`${BASE}&ok=enabled`);
}

export async function cancelSetupAction(formData: FormData): Promise<never> {
  const actor = await currentActor();
  const result = await cancelTwoFactorSetup(
    actor,
    { password: formData.get("password") },
    await requestIp(),
  );

  if (!result.ok) {
    redirect(`${BASE}&error=passord`);
  }

  await refreshSessionCookie(actor.id, result.data.sessionVersion);
  revalidatePath("/innstillinger");
  redirect(BASE);
}

export async function disableTwoFactorAction(formData: FormData): Promise<never> {
  const actor = await currentActor();
  const result = await disableTwoFactor(
    actor,
    {
      password: formData.get("password"),
      code: formData.get("code"),
    },
    await requestIp(),
  );

  if (!result.ok) {
    const error = result.reason === "invalid_password" ? "passord" : "kode";
    redirect(`${BASE}&error=${error}`);
  }

  await refreshSessionCookie(actor.id, result.data.sessionVersion);
  await clearRecoveryCodesForDisplay();
  revalidatePath("/innstillinger");
  redirect(`${BASE}&ok=disabled`);
}

export async function regenerateRecoveryCodesAction(
  formData: FormData,
): Promise<never> {
  const actor = await currentActor();
  const result = await regenerateRecoveryCodes(
    actor,
    { password: formData.get("password") },
    await requestIp(),
  );

  if (!result.ok) {
    redirect(`${BASE}&error=passord`);
  }

  await setRecoveryCodesForDisplay(result.data.recoveryCodes);
  revalidatePath("/innstillinger");
  redirect(`${BASE}&ok=recovery`);
}

/** Skjuler engangskodene når brukeren har lagret eller kopiert dem. */
export async function dismissRecoveryCodesAction(): Promise<never> {
  await clearRecoveryCodesForDisplay();
  revalidatePath("/innstillinger");
  redirect(BASE);
}
