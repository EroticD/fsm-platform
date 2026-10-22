import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { hasPermission, type Permission } from "@/lib/permissions";

/** Henter den innloggede brukeren fra databasen, eller null. */
export async function getCurrentUser() {
  const session = await getServerSession();
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({
    where: { email: session.user.email },
    include: { department: true },
  });
}

/** Navnet på den innloggede brukeren (til aktivitetsloggen). */
export async function actorName(): Promise<string> {
  const session = await getServerSession();
  if (!session?.user?.email) return "Ukjent";
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  return user?.name || session.user.email;
}

// ---------------------------------------------------------------------------
// Roller
//
//   ADMIN      – alt, inkludert sletting og aktivitetslogg
//   OFFICE     – kontor: kunder, utstyr, oppdrag, maler og ansatte i egen
//                avdeling
//   TECHNICIAN – felt: leser kunder, utstyr, rapporter og oppdrag i egen
//                avdeling, og skriver rapporter, kommentarer og fremdrift
//   CUSTOMER   – kundeportal: kun egen kundedata (håndheves i src/proxy.ts)
//
// Standardnivået og eventuelle ekstra rettigheter ligger i permissions.ts.
// Sletting er alltid forbeholdt administrator.
// ---------------------------------------------------------------------------

/** Kontor eller admin: de som administrerer kunder, utstyr, maler og brukere. */
export function isOffice(role?: string | null): boolean {
  return role === "ADMIN" || role === "OFFICE";
}

/** Alle interne roller (alt unntatt kundeportal) – kan lese feltrelevante data. */
export function isStaff(role?: string | null): boolean {
  return isOffice(role) || role === "TECHNICIAN";
}

/**
 * Vakt for server actions.
 *
 * Autorisasjon hører hjemme i handlingen, ikke bare i sidevisningen: en server
 * action er en POST til samme rute, så en skjult knapp hindrer ingen i å kalle
 * den direkte. Handlingen skal derfor avbrytes med `return` når vakten sier nei.
 */
export async function requireOffice(): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user?.isActive) && isOffice(user?.role);
}

/** Som `requireOffice`, men slipper også inn montører (felt-handlinger). */
export async function requireStaff(): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user?.isActive) && isStaff(user?.role);
}

/**
 * Bare administrator. Brukes for handlinger som kan gi andre full tilgang
 * (roller, sletting/deaktivering av administratorer, invitasjoner til admins).
 */
export async function requireAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user?.isActive) && user?.role === "ADMIN";
}

/**
 * Vakt for en navngitt rettighet. Rollen gir standardrettigheter, og en
 * administrator kan i tillegg gi enkelte brukere flere rettigheter.
 */
export async function requirePermission(permission: Permission): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user?.isActive) && hasPermission(user, permission);
}

/** Sletting er alltid forbeholdt administrator, uansett ekstra rettigheter. */
export async function requireDelete(): Promise<boolean> {
  return requireAdmin();
}
