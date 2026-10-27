/**
 * Henter klient-IP bare når appen eksplisitt står bak en betrodd proxy.
 * Uten TRUST_PROXY kan en klient sette X-Forwarded-For fritt, og da er
 * IP-baserte rate limits meningsløse.
 */
export function clientIpFrom(headers: {
  get(name: string): string | null;
}): string | undefined {
  if (process.env.TRUST_PROXY !== "true") return undefined;

  const forwarded = headers.get("x-forwarded-for");
  const candidate =
    forwarded?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "";

  if (!candidate || candidate.length > 100) return undefined;
  // Bare enkle IP-lignende verdier; ikke logger eller vilkårlig tekst.
  if (!/^[0-9a-fA-F:.]+$/.test(candidate)) return undefined;
  return candidate;
}
