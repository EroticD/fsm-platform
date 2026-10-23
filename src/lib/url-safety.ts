import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export { isSafeLogoUrl } from "@/lib/logo";

/** Er en IPv4/IPv6-adresse privat, loopback eller link-local? */
export function isPrivateIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    if (lower.startsWith("::ffff:")) {
      const mapped = lower.slice("::ffff:".length);
      return isIP(mapped) === 4 ? isPrivateIp(mapped) : true;
    }
    return false;
  }

  return true;
}

/**
 * Validerer en ekstern URL og avviser private/loopback/link-local adresser
 * etter DNS-oppslag. Brukes hvis man senere vil tillate eksterne logoer.
 */
export async function assertSafeRemoteUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Ugyldig URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Bare http og https er tillatt");
  }
  if (url.username || url.password) {
    throw new Error("URL-er med innloggingsinfo er ikke tillatt");
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Private adresser er ikke tillatt");
    return url;
  }

  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0) throw new Error("Fant ikke vertsnavnet");
  for (const { address } of addresses) {
    if (isPrivateIp(address)) throw new Error("Private adresser er ikke tillatt");
  }
  return url;
}
