import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { hashToken } from "@/lib/invite";
import { validatePassword, type PasswordPolicyError } from "@/lib/password-policy";
import { bumpSessionVersion } from "@/lib/session";
import { clearCalendarToken } from "@/server/calendar-feed";

export type PasswordResetResult = "ok" | "invalid" | PasswordPolicyError;

/**
 * Bytter passord med en engangs-tilbakestillingsnøkkel.
 *
 * Nøkkelen forbrukes med en atomisk `updateMany` som krever både riktig hash
 * og en utløpstid i fremtiden. To samtidige forespørsler med samme lenke kan
 * derfor ikke begge lykkes: bare den som får `count === 1` fullfører, og den
 * andre får «ugyldig». Det hindrer at en brukt lenke kan gjenbrukes i et race.
 *
 * Passordendringen og revisjonsraden skrives i samme transaksjon. Nøkkelen
 * selv lagres aldri i loggen.
 */
export async function resetPasswordWithToken(
  rawToken: unknown,
  newPassword: unknown,
): Promise<PasswordResetResult> {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  const password = typeof newPassword === "string" ? newPassword : "";

  if (!token) return "invalid";

  const policyError = validatePassword(password);
  if (policyError) return policyError;

  const tokenHash = hashToken(token);
  const now = new Date();

  const user = await prisma.user.findFirst({
    where: {
      resetToken: tokenHash,
      resetTokenExpiry: { gt: now },
    },
    select: { id: true, name: true, email: true },
  });
  if (!user) return "invalid";

  const hashedPassword = await bcrypt.hash(password, 12);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: {
        id: user.id,
        resetToken: tokenHash,
        resetTokenExpiry: { gt: new Date() },
      },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });
    if (result.count !== 1) return false;

    await audit(tx, {
      entityType: "User",
      entityId: user.id,
      action: "Tilbakestilte passord med e-postlenke",
      actor: { id: user.id, name: user.name, email: user.email },
      metadata: { method: "password_reset" },
    });
    return true;
  });
  if (!updated) return "invalid";

  await bumpSessionVersion(user.id);
  await clearCalendarToken(user.id);

  return "ok";
}
