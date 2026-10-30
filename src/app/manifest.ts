import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { BRAND_COLORS } from "@/lib/brand";

function preferredLocale(
  acceptLanguage: string | null,
): "nb" | "en" | "pl" | "de" {
  const first = acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("pl")) return "pl";
  if (first.startsWith("de")) return "de";
  if (first.startsWith("en")) return "en";
  return "nb";
}

/**
 * Web App Manifest – gjør feltappen installerbar på mobil (PWA).
 * Navn og beskrivelse følger nettleserens språk, slik at installasjons-
 * dialogen ikke alltid er norsk for engelske brukere. Ikonene er statiske
 * PNG-filer i /public.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const requestHeaders = await headers();
  const locale = preferredLocale(requestHeaders.get("accept-language"));
  const localized =
    locale === "en"
      ? {
          name: "FSM – field service",
          short_name: "FSM",
          description: "Work orders, checklists and documents in the field.",
        }
      : locale === "pl"
        ? {
            name: "FSM – serwis terenowy",
            short_name: "FSM",
            description:
              "Zlecenia, listy kontrolne i dokumenty w terenie.",
          }
        : locale === "de"
          ? {
              name: "FSM – Außendienst",
              short_name: "FSM",
              description:
                "Aufträge, Checklisten und Dokumente im Außendienst.",
            }
          : {
              name: "FSM – feltapp",
              short_name: "FSM",
              description:
                "Serviceoppdrag, sjekklister og dokumenter i felt.",
            };

  return {
    ...localized,
    lang: locale,
    start_url: "/mine-oppdrag",
    display: "standalone",
    orientation: "portrait",
    background_color: BRAND_COLORS.ink,
    theme_color: BRAND_COLORS.ink,
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
