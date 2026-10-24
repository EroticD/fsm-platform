import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { hasPermission, type Permission } from "@/lib/permissions";

/**
 * Henter den innloggede brukeren fra databasen, eller null.
 *
 * Slår opp på bruker-id (ikke e-post), og avviser økten hvis brukeren er
 * deaktivert eller øktversjonen ikke lenger stemmer. Da blir deaktiverte
 * brukere og gamle JWTs ugyldige umiddelbart.
 */
export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { department: true, roleDefinition: true },
  });
  if (!user?.isActive) return null;
  if (user.sessionVersion !== session.user.sessionVersion) return null;
  return user;
}

/** Navnet på den innloggede brukeren (til aktivitetsloggen). */
export async function actorName(): Promise<string> {
  const user = await getCurrentUser();
  return user?.name || user?.email || "Ukjent";
}

/**
 * Ugyldiggjør alle eksisterende økter for en bruker. Kalles når passord,
 * rolle, rettigheter, aktiv status eller 2FA endres.
 *
 * Returnerer den nye versjonen slik at den som utførte endringen kan fornye
 * sin egen cookie og fortsette å være innlogget.
 */
export async function bumpSessionVersion(userId: string): Promise<number> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  return user.sessionVersion;
}

/**
 * Fornyer session-cookien etter en øktversjonsøkning. Andre økter blir
 * ugyldige, men den som nettopp gjorde endringen skal slippe å logge inn på
 * nytt. Henter bare feltene cookien trenger – aldri passord eller hemmeligheter.
 */
export async function refreshSessionCookie(
  userId: string,
  expectedVersion?: number,
): Promise<void> {
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
  if (!user?.isActive) return;

  // En samtidig invalidering skal ikke overstyres av en gammel fornyelse.
  if (expectedVersion !== undefined && user.sessionVersion !== expectedVersion) {
    return;
  }

  // Dynamisk import holder Next-avhengighetene ute av moduler som bare trenger
  // bumpSessionVersion (for eksempel enhetstester).
  const { createSessionCookie } = await import("@/lib/session-token");
  await createSessionCookie({
    id: user.id,
    email: user.email ?? "",
    name: user.name,
    role: user.role,
    sessionVersion: user.sessionVersion,
  });
}

// ---------------------------------------------------------------------------
// Roller
//
// Rollene ligger i databasen og kan redigeres av administrator. Noen få
// nøkler har fast betydning i koden:
//
//   ADMIN      – alt, inkludert sletting og aktivitetslogg
//   OFFICE     – kontor (standardnivå, kan redigeres)
//   TECHNICIAN – felt (standardnivå, kan redigeres)
//   USER       – standard uten tilgang
//   CUSTOMER   – kundeportal: kun egen kundedata (håndheves i src/proxy.ts)
//
// Rettighetene og eventuelle tilpassede lister ligger i permissions.ts.
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

/** Sletting er som standard forbeholdt administrator. Sletting av oppdrag styres
 *  av rettigheten `workorders.delete`, som kan gis til andre roller/brukere. */
export async function requireDelete(): Promise<boolean> {
  return requireAdmin();
}
