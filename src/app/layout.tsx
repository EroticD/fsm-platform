import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Open_Sans } from "next/font/google";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import { getCurrentUser, isOffice, isStaff } from "@/lib/session";
import { effectivePermissions } from "@/lib/permissions";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import BrandedHeader from "@/components/BrandedHeader";
import MobileTabBar from "@/components/MobileTabBar";
import OfficeRail from "@/components/OfficeRail";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import prisma from "@/lib/prisma";
import { isSafeLogoUrl } from "@/lib/logo";
import { readableTextColor } from "@/lib/colors";
import ToastProvider from "@/components/ToastProvider";
import OfflineBanner from "@/components/OfflineBanner";
import OfflineSessionGuard from "@/components/OfflineSessionGuard";
import RealtimeRefresh from "@/components/RealtimeRefresh";

const openSans = Open_Sans({
  variable: "--font-open-sans",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: {
      default: t("metadata.title"),
      template: t("metadata.titleTemplate"),
    },
    description: t("metadata.description"),
    manifest: "/manifest.webmanifest",
    applicationName: t("metadata.applicationName"),
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      ],
      apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: t("metadata.appleTitle"),
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0F2E4C",
  // La PWA-en bruke hele skjermen, også under hakk og systemlinjer. Header og
  // menylokk kompenserer med safe-area-inset slik at innholdet ikke klippes.
  viewportFit: "cover",
};

const DEFAULT_PRIMARY_COLOR = "#2563eb";

function isHexColor(value: string | null | undefined): value is string {
  return Boolean(value && /^#[0-9a-f]{6}$/i.test(value));
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations("common");
  const session = await getServerSession(authOptions);
  const currentUser = await getCurrentUser();
  const role = currentUser?.role ?? session?.user?.role;
  const permissions = currentUser
    ? Array.from(effectivePermissions(currentUser))
    : [];
  // Merkevaren hentes én gang på serveren, slik at første maling får riktig
  // navn, logo og farge uten en ekstra klientforespørsel.
  const branding = await prisma.branding.findFirst().catch(() => null);
  const companyName = branding?.companyName?.trim() || "FSM System";
  const configuredColor = branding?.primaryColor;
  const primaryColor = isHexColor(configuredColor)
    ? configuredColor
    : DEFAULT_PRIMARY_COLOR;
  const primaryForeground = readableTextColor(primaryColor);
  const logoUrl =
    branding?.logoUrl && isSafeLogoUrl(branding.logoUrl)
      ? branding.logoUrl
      : null;
  // Kontor og administrasjon får den faste venstrelisten. Montørene får
  // feltmodus med mørk topp og mørk bunnlinje. Kundeportalen og innlogging
  // beholder den lyse, enkle rammen.
  const officeMode = isOffice(role);
  const fieldMode = role === "TECHNICIAN";
  const userName = currentUser?.name || session?.user?.name || null;
  const userEmail = currentUser?.email || session?.user?.email || null;

  return (
    <html
      lang={locale}
      className={`${openSans.variable} h-full antialiased ${
        fieldMode ? "field-app" : "office-app"
      }`}
      suppressHydrationWarning
    >
      <body
        className={`min-h-full flex flex-col ${
          fieldMode ? "field-app" : "office-app"
        }`}
        data-mode={fieldMode ? "field" : undefined}
        suppressHydrationWarning
      >
        <style
          dangerouslySetInnerHTML={{
            __html: `:root{--primary-color:${primaryColor};--primary-foreground:${primaryForeground};}`,
          }}
        />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-gray-900 focus:shadow-lg"
        >
          {t("components.header.skipToContent")}
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ToastProvider>
            <OfflineBanner userId={currentUser?.id} />
            {officeMode && (
              <OfficeRail
                role={role}
                permissions={permissions}
                companyName={companyName}
                logoUrl={logoUrl}
                userName={userName}
                userEmail={userEmail}
              />
            )}
            <BrandedHeader
              showNav
              railMode={officeMode}
              role={role}
              permissions={permissions}
              companyName={companyName}
              logoUrl={logoUrl}
              primaryColor={primaryColor}
              userName={userName}
              userEmail={userEmail}
            />
            {/* Sanntidsstrømmen er bare for interne roller. Kundeportalen og
                innloggingssidene skal ikke åpne en SSE-tilkobling. */}
            {isStaff(role) && (
              <>
                <OfflineSessionGuard />
                <RealtimeRefresh />
              </>
            )}
            <main
              id="main-content"
              className={`flex-1 ${
                fieldMode
                  ? "pb-[calc(4.5rem_+_env(safe-area-inset-bottom))]"
                  : isStaff(role)
                    ? "pb-[calc(4.25rem_+_env(safe-area-inset-bottom))] lg:pb-0"
                    : ""
              } ${officeMode ? "lg:pl-[248px]" : ""}`}
            >
              {children}
            </main>
            <MobileTabBar role={role} permissions={permissions} />
            <ServiceWorkerRegister />
          </ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
