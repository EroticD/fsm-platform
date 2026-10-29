import { cookies } from "next/headers";
import { isSecureRequest } from "@/lib/session-token";

/**
 * Kortlevd, HttpOnly cookie for å beholde en engangsnøkkel gjennom en
 * valideringsfeil uten å skrive den tilbake i adressefeltet.
 *
 * Nøkkelen er allerede hemmelig (den ligger bare som hash i databasen), og
 * cookien er bundet til samme nettleser som sendte skjemaet. Den brukes bare
 * til å vise skjemaet på nytt etter f.eks. for kort passord.
 */
const RETRY_TOKEN_MAX_AGE = 10 * 60;

export async function rememberRetryToken(
  cookieName: string,
  token: string,
): Promise<void> {
  if (!token || token.length > 200) return;
  const store = await cookies();
  store.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: await isSecureRequest(),
    maxAge: RETRY_TOKEN_MAX_AGE,
  });
}

export async function readRetryToken(
  cookieName: string,
): Promise<string | null> {
  const store = await cookies();
  return store.get(cookieName)?.value ?? null;
}

export async function clearRetryToken(cookieName: string): Promise<void> {
  const store = await cookies();
  store.delete(cookieName);
}
