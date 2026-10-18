import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";

/** Henter den innloggede brukeren fra databasen, eller null. */
export async function getCurrentUser() {
  const session = await getServerSession();
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({ where: { email: session.user.email } });
}

/** Navnet på den innloggede brukeren (til aktivitetsloggen). */
export async function actorName(): Promise<string> {
  const session = await getServerSession();
  if (!session?.user?.email) return "Ukjent";
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  return user?.name || session.user.email;
}
