import { redirect } from "next/navigation";
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
          <h1 className="text-xl font-bold text-gray-900 mb-2">Passordet er satt</h1>
          <p className="text-gray-600 mb-6">
            Kontoen din må aktiveres av en administrator før du kan logge inn. Du får beskjed
            når den er klar.
          </p>
          <Link
            href="/logg-inn"
            className="inline-block text-white px-6 py-2.5 rounded-xl font-bold"
            suppressHydrationWarning
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            Til innlogging
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
          <h1 className="text-xl font-bold text-red-600 mb-2">Manglende invitasjonsnøkkel</h1>
          <p className="text-gray-600 mb-6">
            Ugyldig eller manglende invitasjonslenke. Be administratoren om en ny lenke.
          </p>
          <Link
            href="/logg-inn"
            className="inline-block bg-gray-800 text-white px-6 py-2.5 rounded-xl font-bold"
          >
            Til innlogging
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
          <h1 className="text-xl font-bold text-red-600 mb-2">Lenken er ugyldig</h1>
          <p className="text-gray-600 mb-6">
            Invitasjonslenken er ugyldig eller har utløpt. Be administratoren om en ny lenke.
          </p>
          <Link
            href="/logg-inn"
            className="inline-block bg-gray-800 text-white px-6 py-2.5 rounded-xl font-bold"
          >
            Til innlogging
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full border">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Velkommen!</h1>
        <p className="text-gray-500 text-sm mb-6">
          Sett ditt eget passord for kontoen <span className="font-bold">{user.email}</span>.
        </p>

        {error === "ugyldig" && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-red-200">
            Linken er ugyldig eller har utløpt.
          </div>
        )}
        {error === "for_kort" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-yellow-200">
            Passordet må være minst 8 tegn.
          </div>
        )}
        {error === "ulike" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-yellow-200">
            Passordene er ikke like. Prøv igjen.
          </div>
        )}

        <form action={setPassword} className="space-y-4">
          <input type="hidden" name="token" value={token} />

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Nytt passord</label>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Minst 8 tegn..."
              className="w-full border p-3 rounded-xl text-gray-800"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Gjenta passord
            </label>
            <input
              type="password"
              name="confirm"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="Skriv passordet på nytt..."
              className="w-full border p-3 rounded-xl text-gray-800"
            />
          </div>

          <button
            type="submit"
            className="w-full text-white py-3 rounded-xl font-bold hover:opacity-90 transition"
            suppressHydrationWarning
            style={{ backgroundColor: "var(--primary-color)" }}
          >
            Lagre passord
          </button>
        </form>
      </div>
    </div>
  );
}
