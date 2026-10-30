import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import Link from "next/link";
import Icon, { type IconName } from "@/components/icons";
import { controlClassName } from "@/components/ui/controlStyles";
import { createSmtpTransport } from "@/lib/email";
import { hashToken } from "@/lib/invite";
import { allowRequestDb } from "@/lib/rate-limit-db";
import { clientIpFrom } from "@/lib/client-ip";
import { cleanEmail } from "@/lib/sanitize";

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="office-app flex min-h-screen items-center justify-center p-4 text-[var(--ink,#101310)] [--focus-ring:var(--ink,#101310)] sm:p-6">
      <div className="relative w-full max-w-md overflow-hidden rounded-[20px] border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-6 shadow-[0_2px_0_rgba(20,17,11,0.08),0_18px_40px_rgba(20,17,11,0.08)] sm:p-8">
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1.5 bg-[var(--signal,#d8ff3e)]"
        />
        {children}
      </div>
    </div>
  );
}

function AuthHeader({
  icon,
  title,
  description,
}: {
  icon: IconName;
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <div className="relative mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--ink,#101310)] bg-[var(--ink,#101310)] text-[var(--paper,#f2efe6)] shadow-[2px_2px_0_var(--signal,#d8ff3e)]">
        <Icon name={icon} className="h-5 w-5" />
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)]"
        />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight text-[var(--ink,#101310)]">
        {title}
      </h1>
      {description && (
        <p className="mt-1 text-sm leading-6 text-[var(--muted,#62685f)]">
          {description}
        </p>
      )}
    </div>
  );
}

function AuthAlert({
  children,
  tone = "risk",
}: {
  children: ReactNode;
  tone?: "risk" | "warning";
}) {
  const toneClass =
    tone === "warning"
      ? "border-[#dfc98b] bg-[#fdf5e4] text-[#6b4808]"
      : "border-[#e7b5ae] bg-[#fdf4f2] text-[var(--risk-text,#b42318)]";
  return (
    <div
      role="alert"
      className={`mb-4 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${toneClass}`}
    >
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

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
        <AuthAlert tone="warning">{t("auth.forgot.rateLimited")}</AuthAlert>
      )}

      {isSuccess ? (
        <>
          <div className="rounded-xl border border-[#b9c99a] bg-[#eef7d6] p-4 text-sm text-[#283509]">
            <p className="flex items-center gap-1.5 font-black">
              <Icon name="check" className="h-4 w-4 shrink-0" />
              {t("auth.forgot.sentTitle")}
            </p>
            <p className="mt-1 leading-5">{t("auth.forgot.sentDesc")}</p>
          </div>
          <Link href="/api/auth/signin" className="signal-button mt-4 w-full">
            {t("auth.forgot.backToLogin")}
          </Link>
        </>
      ) : (
        <>
          <form action={requestReset} className="space-y-4">
            <div>
              <label
                htmlFor="forgot-email"
                className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-[var(--ink,#101310)]"
              >
                {t("auth.forgot.email")}
              </label>
              <input
                id="forgot-email"
                type="email"
                name="email"
                required
                placeholder={t("auth.forgot.emailPlaceholder")}
                className={controlClassName("min-h-11")}
              />
            </div>
            <button type="submit" className="signal-button w-full">
              {t("auth.forgot.submit")}
            </button>
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
