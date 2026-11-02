import { isIP } from "node:net";

/**
 * Henter klient-IP bare når appen eksplisitt står bak en betrodd proxy.
 * Uten TRUST_PROXY kan en klient sette X-Forwarded-For fritt, og da er
 * IP-baserte rate limits meningsløse.
 *
 * TRUST_PROXY betyr at appen står bak en eller flere betrodde reverse
 * proxyer. Hver proxy legger adressen til mottakeren på slutten av
 * X-Forwarded-For. Vi teller derfor like mange hopp fra HØYRE som antallet
 * betrodde proxyer (`TRUST_PROXY_HOPS`, standard 1). Alt lenger til venstre
 * kan klienten selv ha sendt med, og skal aldri brukes som rate-limit-nøkkel.
 *
 * Med én proxy er `TRUST_PROXY_HOPS=1` riktig:
 *
 *   klient → proxy: "spoof, klient"      → vi bruker «klient»
 *
 * Med to proxyer er `TRUST_PROXY_HOPS=2` riktig:
 *
 *   klient → proxy1 → proxy2: "spoof, klient, proxy1" → vi bruker «klient»
 *
 * Er det færre oppføringer enn antallet hopp, gir vi opp i stedet for å falle
 * tilbake til en verdi klienten kan ha sendt. Det gjør en feilkonfigurert
 * proxy til en manglende IP-nøkkel, ikke en omgåelig rate limit.
 */
export function trustedProxyHops(
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  if (env.TRUST_PROXY !== "true") return undefined;

  const raw = env.TRUST_PROXY_HOPS?.trim();
  // Bakoverkompatibel standard: én betrodd proxy. Produksjon krever at
  // verdien settes eksplisitt, se validateProductionConfig().
  if (!raw) return 1;

  if (!/^[1-9][0-9]?$/.test(raw)) return undefined;
  const hops = Number(raw);
  return hops >= 1 && hops <= 10 ? hops : undefined;
}

export function clientIpFrom(headers: {
  get(name: string): string | null;
}): string | undefined {
  const hops = trustedProxyHops();
  if (!hops) return undefined;

  const forwarded = headers.get("x-forwarded-for");
  const parts = forwarded
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean) ?? [];

  // Velg den første adressen som ligger rett bak de betrodde proxyene.
  const candidateFromChain = parts.at(-hops);
  // X-Real-IP er bare et trygt alternativ når vi stoler på nøyaktig én proxy,
  // som forventes å overskrive headeren. Ved flere hopp finnes ikke nok
  // informasjon til å vite hvem som skrev den.
  const candidate =
    candidateFromChain || (hops === 1 ? headers.get("x-real-ip")?.trim() : "");

  if (!candidate || candidate.length > 100) return undefined;
  // Bare ekte IPv4/IPv6-adresser; ikke logger, porter eller vilkårlig tekst.
  if (isIP(candidate) === 0) return undefined;
  return candidate;
}
