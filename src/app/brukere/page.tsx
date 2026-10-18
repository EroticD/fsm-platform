import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import UsersAdmin from "@/components/UsersAdmin";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; error?: string; mail?: string }>;
}) {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/logg-inn");

  const currentUser = await prisma.user.findUnique({ where: { email: session.user.email } });

  if (currentUser?.role === "TECHNICIAN") redirect("/mine-oppdrag");
  if (currentUser?.role === "CUSTOMER") redirect("/kundeportal");

  const { invite, error, mail } = await searchParams;
  const userCount = await prisma.user.count();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex justify-between items-center border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">👷‍♂️ Ansatte & Tilganger</h1>
            <p className="text-gray-500 mt-1">
              Viser totalt {userCount} registrerte brukere i databasen.
            </p>
          </div>
          <Link
            href="/"
            className="bg-white text-gray-700 px-4 py-2 rounded-lg font-medium border hover:bg-gray-50 transition shadow-sm"
          >
            &larr; Tilbake til Dashbord
          </Link>
        </div>

        <UsersAdmin
          returnTo="/brukere"
          currentUserEmail={currentUser?.email}
          invite={invite}
          error={error}
          mail={mail}
        />
      </div>
    </div>
  );
}
