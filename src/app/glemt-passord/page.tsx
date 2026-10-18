import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import nodemailer from "nodemailer";
import Link from "next/link";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ success?: string }> }) {
  const resolvedParams = await searchParams;
  const isSuccess = resolvedParams.success === "true";

  async function requestReset(formData: FormData) {
    "use server";
    const email = formData.get("email") as string;
    if (!email) return;

    // Sjekker om brukeren finnes
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (user) {
      // Lager en 64-tegns tilfeldig og sikker nøkkel
      const token = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 3600000); // Koden er gyldig i 1 time

      // Lagrer nøkkelen på brukeren i databasen
      await prisma.user.update({
        where: { email },
        data: { resetToken: token, resetTokenExpiry: expiry }
      });

      const resetUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/tilbakestill-passord?token=${token}`;

      // TIDSBESPARENDE TRIKS FOR LOKAL TESTING: Printer linken rett i konsollen!
      console.log("\n=======================================================");
      console.log("🔐 LINK FOR TILBAKESTILLING AV PASSORD (Klikk på denne):");
      console.log(resetUrl);
      console.log("=======================================================\n");

      // Forsøker å sende e-post (Fungerer når du legger inn SMTP_HOST i .env senere)
      if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        try {
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || "587"),
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          });
          await transporter.sendMail({
            from: '"System" <no-reply@dittsystem.no>',
            to: email,
            subject: "Tilbakestill ditt passord",
            html: `<p>Du har bedt om å tilbakestille passordet ditt.</p><p><a href="${resetUrl}">Klikk her for å lage nytt passord</a></p><p>Linken er gyldig i 1 time.</p>`
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
        
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Glemt passord?</h1>
        
        {isSuccess ? (
          <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-xl mt-4">
            <p className="font-bold mb-1">E-post sendt!</p>
            <p className="text-sm">Hvis e-postadressen er registrert i vårt system, har vi sendt en link for å tilbakestille passordet. (Sjekk konsollen din for lokal test).</p>
            <Link href="/api/auth/signin" className="block text-center mt-4 bg-gray-800 text-white py-2 rounded-lg font-bold">Tilbake til innlogging</Link>
          </div>
        ) : (
          <>
            <p className="text-gray-500 text-sm mb-6">Skriv inn e-postadressen din, så sender vi deg en link for å lage nytt passord.</p>
            <form action={requestReset} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">E-postadresse</label>
                <input type="email" name="email" required placeholder="ola@bedrift.no" className="w-full border p-3 rounded-xl text-gray-800" />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition">
                Send tilbakestillingslink
              </button>
            </form>
            <div className="mt-6 text-center">
              <Link href="/api/auth/signin" className="text-sm text-blue-600 hover:underline font-medium">&larr; Tilbake til innlogging</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
