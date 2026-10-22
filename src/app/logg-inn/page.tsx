import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/prisma";
import { loginAction } from "./actions";
import SubmitButton from "./SubmitButton";

export const metadata: Metadata = {
  title: "Logg inn",
};

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Feil e-post eller passord.",
  AccountNotActivated:
    "Kontoen din er ikke aktivert ennå. En administrator må aktivere den før du kan logge inn.",
  AccessDenied: "Du har ikke tilgang til denne kontoen.",
  SessionRequired: "Du må logge inn for å se denne siden.",
  TooManyAttempts:
    "For mange innloggingsforsøk. Vent noen minutter og prøv igjen.",
};

const DEFAULT_ERROR = "Kunne ikke logge inn. Prøv igjen.";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error: errorParam, callbackUrl = "/" } = await searchParams;

  const branding = await prisma.branding.findFirst().catch(() => null);
  const companyName = branding?.companyName || "FSM System";

  const error = errorParam
    ? ERROR_MESSAGES[errorParam] || DEFAULT_ERROR
    : null;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-sm mb-3"
            suppressHydrationWarning
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {companyName.charAt(0).toUpperCase()}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Logg inn</h1>
          <p className="text-sm text-gray-500 mt-1">
            Logg inn for å få tilgang til {companyName}
          </p>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/*
          Skjemaet sender e-post og passord i selve forespørselen (POST) via en
          server-action, slik at passordet aldri havner i adressefeltet – og
          slik at innloggingen også virker på enheter der JavaScript ikke har
          rukket å laste/hydrere ennå.
        */}
        <form action={loginAction} className="space-y-4">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-bold text-gray-700 mb-1"
            >
              E-postadresse
            </label>
            <input
              id="email"
              type="email"
              name="email"
              required
              autoComplete="username"
              placeholder="din@epost.no"
              className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium focus:ring-2 focus:ring-[var(--primary-color)] focus:border-transparent outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-bold text-gray-700 mb-1"
            >
              Passord
            </label>
            <input
              id="password"
              type="password"
              name="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full border border-gray-300 p-2.5 rounded-xl text-sm text-gray-900 bg-white font-medium focus:ring-2 focus:ring-[var(--primary-color)] focus:border-transparent outline-none"
            />
          </div>

          <SubmitButton idleLabel="Logg inn" pendingLabel="Logger inn..." />
        </form>

        <div className="text-center mt-6">
          <Link
            href="/glemt-passord"
            className="text-sm font-medium text-gray-500 hover:text-gray-800 transition"
          >
            Glemt passordet?
          </Link>
        </div>
      </div>
    </div>
  );
}
