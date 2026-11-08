import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import Link from "next/link";
import Icon from "@/components/icons";
import {
  AuthAlert,
  AuthHeader,
  AuthShell,
} from "@/components/auth/AuthShell";
import Button, { buttonClassName } from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import { createSmtpTransport } from "@/lib/email";
import { hashToken } from "@/lib/invite";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { clientIpFrom } from "@/lib/client-ip";
import { cleanEmail } from "@/lib/sanitize";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const resolvedParams = await searchParams;
  const isSuccess = resolvedParams.success === "true";
  const isRateLimited = resolvedParams.error === "rate";
  const t = await getTranslations("common");

  async function requestReset(formData: FormData) {
    "use server";
    const email = formData.get("email") as string;
    if (!email) return;

    const normalizedEmail = cleanEmail(email);
    if (!normalizedEmail) {
      redirect("/glemt-passord?success=true");
    }

    const requestHeaders = await headers();
    // Uten TRUST_PROXY er IP-en ukjent. Da hopper vi over IP-nøkkelen helt i
    // stedet for å bruke en felles «ukjent»-bøtte som én anonym klient kan
    // tømme for alle brukere. E-postgrensen under gjelder fortsatt per konto.
    const ip = clientIpFrom(requestHeaders);
    const limits = [
      allowRequestDb(`reset:email:${normalizedEmail}`, 5, 15 * 60_000),
    ];
    if (ip) {
      limits.push(allowRequestDb(`reset:ip:${ip}`, 10, 15 * 60_000));
    }
    const results = await Promise.all(limits);
    if (results.some((result) => !result.allowed)) {
      redirect("/glemt-passord?error=rate");
    }

    // Sjekker om brukeren finnes. Adressen er allerede normalisert til
    // små bokstaver, slik at Kari@Firma.no og kari@firma.no er samme konto.
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    
    if (user) {
      // Lager en 64-tegns tilfeldig og sikker nøkkel
      const token = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 3600000); // Koden er gyldig i 1 time

      // Lagrer nøkkelen på brukeren i databasen
      await prisma.user.update({
        where: { id: user.id },
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
          const transporter = createSmtpTransport();
          await transporter.sendMail({
            from: '"System" <no-reply@dittsystem.no>',
            to: email,
            subject: tr("auth.forgot.emailSubject"),
            html: `<p>${tr("auth.forgot.emailBody")}</p><p><a href="${resetUrl}">${tr("auth.forgot.emailLink")}</a></p><p>${tr("auth.forgot.emailExpiry")}</p>`
          });
        } catch {
          // Rå SMTP-feil kan inneholde mottakeradressen. Logg derfor ingenting
          // som kan knyttes til den innskrevne e-posten.
          console.error("Feil ved sending av tilbakestillings-e-post");
        }
      }
    }

    // Vi omdirigerer uansett, av sikkerhetshensyn (så ikke hackere kan gjette hvilke e-poster som finnes)
    redirect("/glemt-passord?success=true");
  }

  return (
    <AuthShell>
      <AuthHeader
        icon="mail"
        title={t("auth.forgot.title")}
        description={isSuccess ? undefined : t("auth.forgot.desc")}
      />

      {isRateLimited && (
        <AuthAlert tone="warning" message={t("auth.forgot.rateLimited")} />
      )}

      {isSuccess ? (
        <>
          <div className="rounded-xl border border-[color-mix(in_srgb,var(--success-text,#283509)_22%,transparent)] bg-[var(--success-surface,#eef7d6)] p-4 text-sm text-[var(--success-text,#283509)]">
            <p className="flex items-center gap-1.5 font-black">
              <Icon name="check" className="h-4 w-4 shrink-0" />
              {t("auth.forgot.sentTitle")}
            </p>
            <p className="mt-1 leading-5">{t("auth.forgot.sentDesc")}</p>
          </div>
          <Link
            href="/api/auth/signin"
            className={`${buttonClassName()} mt-4 w-full`}
          >
            {t("auth.forgot.backToLogin")}
          </Link>
        </>
      ) : (
        <>
          <form action={requestReset} className="space-y-4">
            <Field label={t("auth.forgot.email")} required>
              <Input
                type="email"
                name="email"
                required
                placeholder={t("auth.forgot.emailPlaceholder")}
              />
            </Field>
            <Button type="submit" className="w-full">
              {t("auth.forgot.submit")}
            </Button>
          </form>
          <div className="mt-6 text-center">
            <Link
              href="/api/auth/signin"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4 transition hover:decoration-[var(--ink,#101310)]"
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("auth.forgot.backToLogin")}
            </Link>
          </div>
        </>
      )}
    </AuthShell>
  );
}
