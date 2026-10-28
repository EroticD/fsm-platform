import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { hashToken } from "@/lib/invite";
import { bumpSessionVersion } from "@/lib/session";
import { clearCalendarToken } from "@/server/calendar-feed";

export type PasswordResetResult = "ok" | "invalid" | "too_short";

/**
 * Bytter passord med en engangs-tilbakestillingsnøkkel.
 *
 * Nøkkelen forbrukes med en atomisk `updateMany` som krever både riktig hash
 * og en utløpstid i fremtiden. To samtidige forespørsler med samme lenke kan
 * derfor ikke begge lykkes: bare den som får `count === 1` fullfører, og den
 * andre får «ugyldig». Det hindrer at en brukt lenke kan gjenbrukes i et race.
 */
export async function resetPasswordWithToken(
  rawToken: unknown,
  newPassword: unknown,
): Promise<PasswordResetResult> {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  const password = typeof newPassword === "string" ? newPassword : "";

  if (!token) return "invalid";
  if (password.length < 8) return "too_short";

  const tokenHash = hashToken(token);
  const now = new Date();

  const user = await prisma.user.findFirst({
    where: {
      resetToken: tokenHash,
      resetTokenExpiry: { gt: now },
    },
    select: { id: true },
  });
  if (!user) return "invalid";

  const hashedPassword = await bcrypt.hash(password, 10);

  const updated = await prisma.user.updateMany({
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
  if (updated.count !== 1) return "invalid";

  await bumpSessionVersion(user.id);
  await clearCalendarToken(user.id);

  return "ok";
}
