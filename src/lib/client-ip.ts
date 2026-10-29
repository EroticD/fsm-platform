/**
 * Henter klient-IP bare når appen eksplisitt står bak en betrodd proxy.
 * Uten TRUST_PROXY kan en klient sette X-Forwarded-For fritt, og da er
 * IP-baserte rate limits meningsløse.
 *
 * TRUST_PROXY betyr at appen står bak én betrodd reverse proxy som legger
 * klientadressen til på slutten av X-Forwarded-For. Vi bruker derfor den
 * SISTE oppføringen: alt lenger til venstre kan klienten selv ha sendt med.
 * Har dere flere betrodde proxyer, må antall hopp telles eksplisitt her i
 * stedet for å stole på første verdi.
 */
export function clientIpFrom(headers: {
  get(name: string): string | null;
}): string | undefined {
  if (process.env.TRUST_PROXY !== "true") return undefined;

  const forwarded = headers.get("x-forwarded-for");
  const lastForwarded = forwarded
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);

  const candidate = lastForwarded || headers.get("x-real-ip")?.trim() || "";

  if (!candidate || candidate.length > 100) return undefined;
  // Bare enkle IP-lignende verdier; ikke logger eller vilkårlig tekst.
  if (!/^[0-9a-fA-F:.]+$/.test(candidate)) return undefined;
  return candidate;
}
