"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { encode } from "next-auth/jwt";
import { verifyCredentials } from "@/lib/credentials";

const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 dager, samme som NextAuth sin standard

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

  const result = await verifyCredentials(email, password);
  if (result.status !== "ok") {
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
  const requestHeaders = await headers();
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
