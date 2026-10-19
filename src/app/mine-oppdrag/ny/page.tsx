import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import CreateWorkOrderForm from "./CreateWorkOrderForm";

export default async function TechnicianCreateWorkOrderPage() {
  const session = await getServerSession();
  if (!session || !session.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (user?.role !== "TECHNICIAN" && user?.role !== "ADMIN" && user?.role !== "OFFICE") redirect("/");

  // Henter kunder og maler fra databasen
  const customers = await prisma.customer.findMany({ orderBy: { name: 'asc' } });
  const templates = await prisma.template.findMany({ orderBy: { title: 'asc' } });
  const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });

  return <CreateWorkOrderForm customers={customers} templates={templates} tags={tags} />;
}
