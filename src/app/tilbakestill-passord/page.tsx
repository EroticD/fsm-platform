import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import bcrypt from "bcryptjs";
import Link from "next/link";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string, error?: string }> }) {
  const resolvedParams = await searchParams;
  const token = resolvedParams.token;
  const error = resolvedParams.error;

  // Sikkerhetssjekk: Kom de hit uten token?
  if (!token) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow border max-w-md w-full text-center">
          <p className="text-4xl mb-4">⚠️</p>
          <h1 className="text-xl font-bold text-red-600 mb-2">Manglende sikkerhetsnøkkel</h1>
          <p className="text-gray-600 mb-6">Ugyldig eller manglende link. Prøv å be om en ny tilbakestillingslink.</p>
          <Link href="/glemt-passord" className="bg-gray-800 text-white px-6 py-2 rounded-lg font-bold">Gå til glemt passord</Link>
        </div>
      </div>
    );
  }

  async function resetPassword(formData: FormData) {
    "use server";
    const newPassword = formData.get("password") as string;
    const token = formData.get("token") as string;

    if (!newPassword || newPassword.length < 6) {
      redirect(`/tilbakestill-passord?token=${token}&error=for_kort`);
    }

    // Finner brukeren som eier denne koden, og sjekker at tiden ikke har gått ut
    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gt: new Date() } // Må være i fremtiden
      }
    });

    if (!user) {
      redirect(`/tilbakestill-passord?token=${token}&error=ugyldig`);
    }

    // Krypterer (hasher) det nye passordet for sikker lagring!
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Lagrer passordet og fjerner den brukte sikkerhetskoden (kan bare brukes én gang)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null
      }
    });

    // Sender brukeren til innlogging
    redirect("/api/auth/signin");
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full border">
        
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Lage nytt passord</h1>
        <p className="text-gray-500 text-sm mb-6">Skriv inn ditt nye ønskede passord nedenfor.</p>
        
        {error === "ugyldig" && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-red-200">
            Linken er ugyldig eller har utløpt.
          </div>
        )}
        {error === "for_kort" && (
          <div className="bg-yellow-50 text-yellow-700 p-3 rounded-lg mb-4 text-sm font-semibold border border-yellow-200">
            Passordet må være minst 6 tegn.
          </div>
        )}

        <form action={resetPassword} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Nytt passord</label>
            <input type="password" name="password" required minLength={6} placeholder="Minst 6 tegn..." className="w-full border p-3 rounded-xl text-gray-800" />
          </div>
          
          <button type="submit" className="w-full bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 transition">
            Lagre nytt passord
          </button>
        </form>
      </div>
    </div>
  );
}
