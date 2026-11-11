/**
 * Enkel, konservativ brukeragent-deteksjon for telefoner og nettbrett.
 *
 * Vi bruker den bare til å velge startflate etter innlogging: montører skal
 * få feltportalen på mobil og kontordashbordet på desktop. Den skal aldri
 * brukes til sikkerhetsvurderinger, og en ukjent agent regnes som desktop.
 *
 * Desktop-nettlesere (Windows, macOS, Linux, ChromeOS) inneholder ingen av
 * markørene under, så de faller trygt tilbake til `false`.
 */
const MOBILE_USER_AGENT =
  /iPhone|iPod|iPad|Android|Windows Phone|IEMobile|BlackBerry|BB10|PlayBook|webOS|Opera Mini|Mobile Safari|Kindle|Silk|Tablet/i;

export function isMobileUserAgent(
  userAgent: string | null | undefined,
): boolean {
  if (!userAgent) return false;
  return MOBILE_USER_AGENT.test(userAgent);
}
