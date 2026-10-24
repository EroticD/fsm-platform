import crypto from "node:crypto";

/** Konstant-tids sammenligning av to hemmeligheter. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Henter Bearer-tokenet fra Authorization-headeren, eller null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Godtar bare et Bearer-token som matcher en av de konfigurerte
 * hemmelighetene. En vilkårlig Authorization-header er ikke nok.
 */
export function hasValidBearer(
  request: Request,
  secrets: Array<string | undefined>,
): boolean {
  const token = bearerToken(request);
  if (!token) return false;
  const configured = secrets.filter((value): value is string => Boolean(value));
  if (configured.length === 0) return false;
  return configured.some((secret) => safeEqual(token, secret));
}
