import crypto from "crypto";
import prisma from "@/lib/prisma";

// Hvor lenge en invitasjonslenke er gyldig (7 dager).
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Genererer en ny invitasjonsnøkkel for en bruker og lagrer den.
 * Returnerer den rå nøkkelen som skal legges i invitasjonslenken.
 */
export async function createInviteToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: userId },
    data: {
      resetToken: token,
      resetTokenExpiry: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
  return token;
}

/** Bygger den fulle invitasjons-URLen som sendes/kopieres til brukeren. */
export function buildInviteUrl(token: string): string {
  const base = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/aktiver-konto?token=${token}`;
}
