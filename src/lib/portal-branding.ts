import { cleanColor } from "@/lib/sanitize";
import { isSafeLogoUrl } from "@/lib/logo";

export type PortalBrandingInput = {
  name: string;
  brandColor: string | null;
  logoUrl: string | null;
};

export type PortalBranding = {
  color: string;
  logo: string | null;
  initial: string;
};

/**
 * Kundens merkevare i portalen. Fargen valideres som hex, og logoen må være en
 * trygg opplastings-URL. En ugyldig verdi faller tilbake til standardfargen og
 * initialen, aldri til en vilkårlig ekstern URL.
 */
export function portalBranding(input: PortalBrandingInput): PortalBranding {
  return {
    color: cleanColor(input.brandColor) || "#d8ff3e",
    logo: isSafeLogoUrl(input.logoUrl) ? input.logoUrl : null,
    initial: input.name.trim().charAt(0).toUpperCase() || "?",
  };
}
