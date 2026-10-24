import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import Link from "next/link";
import { hashToken } from "@/lib/invite";
import { bumpSessionVersion } from "@/lib/session";

export default async function ActivateAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; success?: string }>;
}) {
  const { token, error, success } = await searchParams;
  const t = await getTranslations("common");

  // --- SERVER ACTION: sett eget passord ---
  async function setPassword(formData: FormData) {
    "use server";
    const newPassword = formData.get("password") as string;
    const confirmPassword = formData.get("confirm") as string;
    const formToken = formData.get("token") as string;

    if (!newPassword || newPassword.length < 8) {
      redirect(`/aktiver-konto?token=${formToken}&error=for_kort`);
    }
    if (newPassword !== confirmPassword) {
      redirect(`/aktiver-konto?token=${formToken}&error=ulike`);
    }

    const user = await prisma.user.findFirst({
      where: {
        resetToken: hashToken(formToken),
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      redirect(`/aktiver-konto?error=ugyldig`);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Passordet lagres, men kontoen er fortsatt inaktiv til en administrator
    // aktiverer den. Nøkkelen kan bare brukes én gang.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });
    await bumpSessionVersion(user.id);

    await prisma.auditLog.create({
      data: {
        entityType: "User",
        entityId: user.id,
        action: `Bruker satte eget passord: ${user.name || user.email}`,
        userName: user.name || user.email || "Ukjent",
      },
    });

    redirect("/aktiver-konto?success=true");
  }

  // --- SUKSESS ---
  if (success === "true") {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow border max-w-md w-full text-center">
          <p className="text-4xl mb-4">✅</p>
          <h1 className="text-xl font-bold text-gray-900 mb-2">{t("auth.activate.successTitle")}</h1>
          <p className="text-gray-600 mb-6">
            {t("auth.activate.successDesc")}
          </p>
          <Link
            href="/logg-inn"
            className="inline-block text-white px-6 py-2.5 rounded-xl font-bold"
            suppressHydrationWarning
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {t("auth.activate.toLogin")}
          </Link>
        </div>
      </div>
    );
  }

  // --- MANGLER NØKKEL ---
  if (!token) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow border max-w-md w-full text-center">
          <p className="text-4xl mb-4">⚠️</p>
          <h1 className="text-xl font-bold text-red-600 mb-2">{t("auth.activate.missingTitle")}</h1>
          <p className="text-gray-600 mb-6">
            {t("auth.activate.missingDesc")}
          </p>
          <Link
            href="/logg-inn"
            className="inline-block bg-gray-800 text-white px-6 py-2.5 rounded-xl font-bold"
          >
            {t("auth.activate.toLogin")}
          </Link>
        </div>
      </div>
    );
  }

  // --- VALIDER NØKKEL ---
  const user = await prisma.user.findFirst({
    where: {
      resetToken: hashToken(token),
      resetTokenExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow border max-w-md w-full text-center">
          <p className="text-4xl mb-4">⚠️</p>
          <h1 className="text-xl font-bold text-red-600 mb-2">{t("auth.activate.invalidTitle")}</h1>
          <p className="text-gray-600 mb-6">
            {t("auth.activate.invalidDesc")}
          </p>
          <Link
            href="/logg-inn"
            className="inline-block bg-gray-800 text-white px-6 py-2.5 rounded-xl font-bold"
          >
            {t("auth.activate.toLogin")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full border">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{t("auth.activate.welcome")}</h1>
        <p className="text-gray-500 text-sm mb-6">
          {t.rich("auth.activate.desc", {
            email: user.email ?? "",
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>

        {error === "ugyldig" && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-red-200">
            {t("auth.activate.errors.invalid")}
          </div>
        )}
        {error === "for_kort" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-yellow-200">
            {t("auth.activate.errors.tooShort")}
          </div>
        )}
        {error === "ulike" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-yellow-200">
            {t("auth.activate.errors.mismatch")}
          </div>
        )}

        <form action={setPassword} className="space-y-4">
          <input type="hidden" name="token" value={token} />

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">{t("auth.activate.newPassword")}</label>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder={t("auth.activate.newPasswordPlaceholder")}
              className="w-full border p-3 rounded-xl text-gray-800"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              {t("auth.activate.confirm")}
            </label>
            <input
              type="password"
              name="confirm"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder={t("auth.activate.confirmPlaceholder")}
              className="w-full border p-3 rounded-xl text-gray-800"
            />
          </div>

          <button
            type="submit"
            className="w-full text-white py-3 rounded-xl font-bold hover:opacity-90 transition"
            suppressHydrationWarning
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            {t("auth.activate.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
