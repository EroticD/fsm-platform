import crypto from "crypto";
import prisma from "@/lib/prisma";

// Hvor lenge en invitasjonslenke er gyldig (7 dager).
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Nøkkelen lagres som en SHA-256-hash, aldri i klartekst. Da kan ikke en
 * databasekopi brukes til å ta over kontoer. Den rå nøkkelen finnes bare i
 * lenken som vises/sendes én gang.
 */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Genererer en ny invitasjonsnøkkel for en bruker og lagrer hashen.
 * Returnerer den rå nøkkelen som skal legges i invitasjonslenken.
 */
export async function createInviteToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.user.update({
    where: { id: userId },
    data: {
      resetToken: hashToken(token),
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
