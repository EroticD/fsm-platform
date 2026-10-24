import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import BrandedHeader from "@/components/BrandedHeader";
import BrandingColors from "@/components/BrandingColors";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import ToastProvider from "@/components/ToastProvider";

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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const messages = await getMessages();
  const session = await getServerSession(authOptions);

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
          Hopp til innhold
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ToastProvider>
            <BrandingColors />
            <BrandedHeader showNav role={session?.user?.role} />
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
