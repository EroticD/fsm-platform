import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import UsersAdmin from "@/components/UsersAdmin";
import { getCurrentUser } from "@/lib/session";
import { effectivePermissions, hasPermission } from "@/lib/permissions";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; inviteToken?: string; error?: string; mail?: string }>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/logg-inn");

  if (currentUser.role === "CUSTOMER") redirect("/kundeportal");
  if (!hasPermission(currentUser, "users.view")) redirect("/");

  const { invite, inviteToken, error, mail } = await searchParams;
  const userCount = await prisma.user.count({
    where:
      currentUser.role === "ADMIN"
        ? {}
        : { departmentId: currentUser.departmentId ?? "__ingen_avdeling__" },
  });

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex justify-between items-center border-b pb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">👷‍♂️ Ansatte & Tilganger</h1>
            <p className="text-gray-500 mt-1">
              {currentUser.role === "ADMIN"
                ? `Viser totalt ${userCount} registrerte brukere i databasen.`
                : `Viser ${userCount} brukere i din avdeling.`}
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
          isAdmin={currentUser?.role === "ADMIN"}
          departmentId={currentUser?.departmentId}
          canManageCustomers={hasPermission(currentUser, "customers.manage")}
          actorPermissions={Array.from(effectivePermissions(currentUser))}
          invite={invite}
          inviteToken={inviteToken}
          error={error}
          mail={mail}
        />
      </div>
    </div>
  );
}
