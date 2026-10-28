import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import { getCurrentUser, isStaff } from "@/lib/session";
import { effectivePermissions } from "@/lib/permissions";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import BrandedHeader from "@/components/BrandedHeader";
import BrandingColors from "@/components/BrandingColors";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import ToastProvider from "@/components/ToastProvider";
import OfflineBanner from "@/components/OfflineBanner";
import RealtimeRefresh from "@/components/RealtimeRefresh";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FSM-plattformen",
  description: "Service- og vedlikeholdssystem for oppdrag, rapporter og utstyr",
  manifest: "/manifest.webmanifest",
  applicationName: "FSM",
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
    title: "FSM",
  },
};

export const viewport = {
  themeColor: "#0F2E4C",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const t = await getTranslations("common");
  const session = await getServerSession(authOptions);
  const currentUser = await getCurrentUser();
  const permissions = currentUser
    ? Array.from(effectivePermissions(currentUser))
    : [];

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-gray-900 focus:shadow-lg"
        >
          {t("components.header.skipToContent")}
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ToastProvider>
            <BrandingColors />
            <OfflineBanner userId={currentUser?.id} />
            <BrandedHeader
              showNav
              role={currentUser?.role ?? session?.user?.role}
              permissions={permissions}
            />
            {/* Sanntidsstrømmen er bare for interne roller. Kundeportalen og
                innloggingssidene skal ikke åpne en SSE-tilkobling. */}
            {isStaff(currentUser?.role ?? session?.user?.role) && (
              <RealtimeRefresh />
            )}
            <main id="main-content" className="flex-1">
              {children}
            </main>
            <ServiceWorkerRegister />
          </ToastProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
