// i18n-ignore-file: PWA-manifestet velger språk fra Accept-Language før
// next-intl-konteksten finnes. Tekstene er allerede lokalisert i filen.
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
  const shortcutIcon = [
    {
      src: "/android-chrome-192x192.png",
      sizes: "192x192",
      type: "image/png",
    },
  ];
  const localized =
    locale === "en"
      ? {
          name: "FSM – field service",
          short_name: "FSM",
          description: "Work orders, checklists and documents in the field.",
          shortcuts: [
            {
              name: "My jobs",
              short_name: "Jobs",
              url: "/mine-oppdrag",
              icons: shortcutIcon,
            },
            {
              name: "Scan",
              short_name: "Scan",
              url: "/skann",
              icons: shortcutIcon,
            },
            {
              name: "Today",
              short_name: "Today",
              url: "/mine-oppdrag#senere",
              icons: shortcutIcon,
            },
          ],
        }
      : locale === "pl"
        ? {
            name: "FSM – serwis terenowy",
            short_name: "FSM",
            description:
              "Zlecenia, listy kontrolne i dokumenty w terenie.",
            shortcuts: [
              {
                name: "Moje zlecenia",
                short_name: "Zlecenia",
                url: "/mine-oppdrag",
                icons: shortcutIcon,
              },
              {
                name: "Skanuj",
                short_name: "Skanuj",
                url: "/skann",
                icons: shortcutIcon,
              },
              {
                name: "Dzisiaj",
                short_name: "Dzisiaj",
                url: "/mine-oppdrag#senere",
                icons: shortcutIcon,
              },
            ],
          }
        : locale === "de"
          ? {
              name: "FSM – Außendienst",
              short_name: "FSM",
              description:
                "Aufträge, Checklisten und Dokumente im Außendienst.",
              shortcuts: [
                {
                  name: "Meine Aufträge",
                  short_name: "Aufträge",
                  url: "/mine-oppdrag",
                  icons: shortcutIcon,
                },
                {
                  name: "Scannen",
                  short_name: "Scannen",
                  url: "/skann",
                  icons: shortcutIcon,
                },
                {
                  name: "Heute",
                  short_name: "Heute",
                  url: "/mine-oppdrag#senere",
                  icons: shortcutIcon,
                },
              ],
            }
          : {
              name: "FSM – feltapp",
              short_name: "FSM",
              description:
                "Serviceoppdrag, sjekklister og dokumenter i felt.",
              shortcuts: [
                {
                  name: "Mine oppdrag",
                  short_name: "Oppdrag",
                  url: "/mine-oppdrag",
                  icons: shortcutIcon,
                },
                {
                  name: "Skann",
                  short_name: "Skann",
                  url: "/skann",
                  icons: shortcutIcon,
                },
                {
                  name: "I dag",
                  short_name: "I dag",
                  url: "/mine-oppdrag#senere",
                  icons: shortcutIcon,
                },
              ],
            };

  return {
    ...localized,
    id: "/",
    lang: locale,
    start_url: "/mine-oppdrag",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    categories: ["business", "productivity"],
    prefer_related_applications: false,
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
