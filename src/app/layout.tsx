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
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FSM",
  },
};

export const viewport = {
  themeColor: "#2563eb",
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
        <NextIntlClientProvider locale={locale} messages={messages}>
          <BrandingColors />
          <BrandedHeader showNav role={session?.user?.role} />
          {children}
          <ServiceWorkerRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
