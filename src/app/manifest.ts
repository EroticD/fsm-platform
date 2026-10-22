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
    background_color: "#f3f4f6",
    theme_color: "#2563eb",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
