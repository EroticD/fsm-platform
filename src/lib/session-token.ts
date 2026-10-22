import { cookies, headers } from "next/headers";
import { encode } from "next-auth/jwt";

/** Samme levetid som `session.maxAge` i auth-options.ts. */
export const SESSION_MAX_AGE = 12 * 60 * 60;

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

/** Er forespørselen over HTTPS (direkte eller bak en reverse proxy)? */
export async function isSecureRequest(): Promise<boolean> {
  const requestHeaders = await headers();
  return (
    (process.env.NEXTAUTH_URL ?? "").startsWith("https://") ||
    requestHeaders.get("x-forwarded-proto") === "https"
  );
}

/**
 * Skriver NextAuth-session-cookien for en bruker. Brukes av både vanlig
 * innlogging og 2FA-trinnet, slik at cookie-navn og levetid er identisk.
 */
export async function createSessionCookie(user: SessionUser): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET mangler");

  const secure = await isSecureRequest();
  const sessionToken = await encode({
    token: {
      sub: user.id,
      id: user.id,
      email: user.email,
      name: user.name ?? undefined,
      role: user.role,
    },
    secret,
    maxAge: SESSION_MAX_AGE,
  });

  const cookieStore = await cookies();
  cookieStore.set(
    secure ? "__Secure-next-auth.session-token" : "next-auth.session-token",
    sessionToken,
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
      maxAge: SESSION_MAX_AGE,
    },
  );
}

/** Midlertidig cookie mens brukeren taster 2FA-koden. */
export const PENDING_2FA_COOKIE = "fsm-2fa-pending";
/** Hvor lenge 2FA-steget er gyldig (5 minutter). */
export const PENDING_2FA_MAX_AGE = 5 * 60;

export type PendingTwoFactor = {
  userId: string;
  expires: number;
};

/** Signerer en midlertidig «venter på 2FA»-cookie. */
export async function setPendingTwoFactor(userId: string): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET mangler");

  const expires = Date.now() + PENDING_2FA_MAX_AGE * 1000;
  const token = await encode({
    token: { sub: userId, expires },
    secret,
    maxAge: PENDING_2FA_MAX_AGE,
  });

  const cookieStore = await cookies();
  cookieStore.set(PENDING_2FA_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: await isSecureRequest(),
    maxAge: PENDING_2FA_MAX_AGE,
  });
}

/** Leser og validerer den midlertidige 2FA-cookien. */
export async function readPendingTwoFactor(): Promise<string | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;

  const { decode } = await import("next-auth/jwt");
  const cookieStore = await cookies();
  const raw = cookieStore.get(PENDING_2FA_COOKIE)?.value;
  if (!raw) return null;

  try {
    const payload = await decode({ token: raw, secret });
    if (!payload?.sub) return null;
    const expires = Number(payload.expires ?? 0);
    if (!expires || expires < Date.now()) return null;
    return String(payload.sub);
  } catch {
    return null;
  }
}

/** Sletter den midlertidige 2FA-cookien. */
export async function clearPendingTwoFactor(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(PENDING_2FA_COOKIE);
}
