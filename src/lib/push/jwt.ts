/** Hjelpere for kompakte JWS-tokens uten en ekstern JWT-avhengighet. */

export function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function jwtSigningInput(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
): string {
  return `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
}

export function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    ),
  ) as Record<string, unknown>;
}
