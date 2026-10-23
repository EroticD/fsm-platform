/**
 * Godkjente logo-URL-er. Vi tillater bare filer som er lastet opp gjennom
 * appens egen opplastingsrute – ikke vilkårlige eksterne URL-er.
 *
 * Det fjerner SSRF-risikoen (f.eks. en logo som peker på
 * http://169.254.169.254/latest/meta-data) og gjør at PDF-generering,
 * e-post og kundeportalen aldri henter innhold fra ukjente tjenere.
 *
 * Denne modulen er ren og kan importeres både fra server og klient.
 */
const UPLOAD_LOGO = /^\/uploads\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif)$/i;

export function isSafeLogoUrl(value: string | null | undefined): boolean {
  return UPLOAD_LOGO.test((value ?? "").trim());
}
