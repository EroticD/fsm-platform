import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import nodemailer from "nodemailer";
import Link from "next/link";
import { hashToken } from "@/lib/invite";
import { allowRequestDb } from "@/lib/rate-limit-db";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const resolvedParams = await searchParams;
  const isSuccess = resolvedParams.success === "true";
  const isRateLimited = resolvedParams.error === "rate";
  const t = await getTranslations("common");

  async function requestReset(formData: FormData) {
    "use server";
    const email = formData.get("email") as string;
    if (!email) return;

    const requestHeaders = await headers();
    const ip =
      requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      requestHeaders.get("x-real-ip") ||
      "ukjent";
    const normalizedEmail = email.trim().toLowerCase();
    const [emailLimit, ipLimit] = await Promise.all([
      allowRequestDb(`reset:email:${normalizedEmail}`, 5, 15 * 60_000),
      allowRequestDb(`reset:ip:${ip}`, 10, 15 * 60_000),
    ]);
    if (!emailLimit.allowed || !ipLimit.allowed) {
      redirect("/glemt-passord?error=rate");
    }

    // Sjekker om brukeren finnes
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (user) {
      // Lager en 64-tegns tilfeldig og sikker nøkkel
      const token = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 3600000); // Koden er gyldig i 1 time

      // Lagrer nøkkelen på brukeren i databasen
      await prisma.user.update({
        where: { email },
        data: { resetToken: hashToken(token), resetTokenExpiry: expiry }
      });

      const resetUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/tilbakestill-passord?token=${token}`;

      // Lokal hjelp når SMTP ikke er satt opp. Aldri i produksjon: en gyldig
      // tilbakestillingslenke i serverloggen er det samme som kontotilgang.
      if (process.env.NODE_ENV !== "production") {
        console.log("\n=======================================================");
        console.log("🔐 LINK FOR TILBAKESTILLING AV PASSORD (Klikk på denne):");
        console.log(resetUrl);
        console.log("=======================================================\n");
      }

      // Forsøker å sende e-post (Fungerer når du legger inn SMTP_HOST i .env senere)
      if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        try {
          const tr = await getTranslations("common");
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || "587"),
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          });
          await transporter.sendMail({
            from: '"System" <no-reply@dittsystem.no>',
            to: email,
            subject: tr("auth.forgot.emailSubject"),
            html: `<p>${tr("auth.forgot.emailBody")}</p><p><a href="${resetUrl}">${tr("auth.forgot.emailLink")}</a></p><p>${tr("auth.forgot.emailExpiry")}</p>`
          });
        } catch (e) {
          console.error("Feil ved sending av e-post:", e);
        }
      }
    }

    // Vi omdirigerer uansett, av sikkerhetshensyn (så ikke hackere kan gjette hvilke e-poster som finnes)
    redirect("/glemt-passord?success=true");
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full border">
        
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{t("auth.forgot.title")}</h1>
        
        {isRateLimited && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl mt-4 text-sm">
            {t("auth.forgot.rateLimited")}
          </div>
        )}

        {isSuccess ? (
          <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-xl mt-4">
            <p className="font-bold mb-1">{t("auth.forgot.sentTitle")}</p>
            <p className="text-sm">{t("auth.forgot.sentDesc")}</p>
            <Link href="/api/auth/signin" className="block text-center mt-4 bg-gray-800 text-white py-2 rounded-lg font-bold">{t("auth.forgot.backToLogin")}</Link>
          </div>
        ) : (
          <>
            <p className="text-gray-500 text-sm mb-6">{t("auth.forgot.desc")}</p>
            <form action={requestReset} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">{t("auth.forgot.email")}</label>
                <input type="email" name="email" required placeholder={t("auth.forgot.emailPlaceholder")} className="w-full border p-3 rounded-xl text-gray-800" />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition">
                {t("auth.forgot.submit")}
              </button>
            </form>
            <div className="mt-6 text-center">
              <Link href="/api/auth/signin" className="text-sm text-blue-600 hover:underline font-medium">&larr; {t("auth.forgot.backToLogin")}</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
