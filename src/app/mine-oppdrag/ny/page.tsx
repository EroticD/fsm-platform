import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import CreateWorkOrderForm from "./CreateWorkOrderForm";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

export default async function TechnicianCreateWorkOrderPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.create")) redirect("/");

  if (!user.departmentId) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-xl mx-auto bg-white border-2 border-amber-200 rounded-2xl p-6 space-y-3">
          <h1 className="text-xl font-black text-gray-900">Du mangler avdeling</h1>
          <p className="text-sm text-gray-700">
            For å opprette oppdrag må du være knyttet til en avdeling. Be en
            administrator om å legge deg til i en avdeling.
          </p>
          <Link href="/mine-oppdrag" className="inline-block bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-bold">
            ← Tilbake til mine oppdrag
          </Link>
        </div>
      </div>
    );
  }

  // Henter kunder og maler fra databasen
  const customers = await prisma.customer.findMany({ orderBy: { name: 'asc' } });
  const templates = await prisma.template.findMany({ orderBy: { title: 'asc' } });
  const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });

  return <CreateWorkOrderForm customers={customers} templates={templates} tags={tags} />;
}
