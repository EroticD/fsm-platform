import type { MetadataRoute } from "next";

/**
 * Web App Manifest – gjør feltappen installerbar på mobil (PWA).
 * Ikonene genereres fra appens branding der det er mulig; her bruker vi
 * statiske PNG-ikoner i /public.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FSM – feltapp",
    short_name: "FSM",
    description: "Serviceoppdrag, sjekklister og dokumenter i felt.",
    start_url: "/mine-oppdrag",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0F2E4C",
    theme_color: "#0F2E4C",
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
