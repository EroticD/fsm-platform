"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { encode } from "next-auth/jwt";
import { verifyCredentials } from "@/lib/credentials";

// Samme levetid som `session.maxAge` i auth-options.ts.
const SESSION_MAX_AGE = 12 * 60 * 60;

/**
 * Godtar både relative stier ("/kunder") og absolutte URL-er
 * ("http://10.0.0.115:3000/kunder"), og returnerer alltid en trygg, relativ
 * sti. Da kan vi aldri sende brukeren til et annet domene etter innlogging.
 */
function safeRelativeTarget(value: string | null): string {
  if (!value) return "/";
  try {
    const url = new URL(value, "http://relative.invalid");
    if (url.protocol !== "http:" && url.protocol !== "https:") return "/";
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "/";
  }
}

/**
 * Logger inn uten JavaScript.
 *
 * Skjemaet på /logg-inn sender inn til denne server-actionen, som poster
 * e-post og passord i selve forespørselen. Passordet havner derfor aldri i
 * adressefeltet, og innloggingen virker også før (eller uten at) React har
 * lastet ned og hydrert på enheten.
 */
export async function loginAction(formData: FormData): Promise<never> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = safeRelativeTarget(
    typeof formData.get("callbackUrl") === "string"
      ? (formData.get("callbackUrl") as string)
      : null
  );

  const fail = (error: string): string => {
    const params = new URLSearchParams({ error });
    if (callbackUrl !== "/") params.set("callbackUrl", callbackUrl);
    return `/logg-inn?${params.toString()}`;
  };

  // Bak en reverse proxy er x-forwarded-for satt av proxyen. Uten proxy faller
  // vi tilbake til å bare begrense per e-postkonto.
  const requestHeaders = await headers();
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    undefined;

  const result = await verifyCredentials(email, password, ip);
  if (result.status !== "ok") {
    if (result.status === "locked") {
      redirect(fail("TooManyAttempts"));
    }
    redirect(
      fail(result.status === "inactive" ? "AccountNotActivated" : "CredentialsSignin")
    );
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    redirect(fail("SessionRequired"));
  }

  // Cookienavnet må matche det NextAuth selv ville brukt, ellers ser ikke
  // proxyen og server-komponentene økten etterpå.
  const secure =
    (process.env.NEXTAUTH_URL ?? "").startsWith("https://") ||
    requestHeaders.get("x-forwarded-proto") === "https";

  const sessionToken = await encode({
    token: {
      sub: result.user.id,
      id: result.user.id,
      email: result.user.email,
      name: result.user.name ?? undefined,
      role: result.user.role,
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
    }
  );

  redirect(callbackUrl);
}
