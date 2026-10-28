import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import CreateWorkOrderForm from "./CreateWorkOrderForm";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

export default async function TechnicianCreateWorkOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "workorders.create")) redirect("/");

  const t = await getTranslations("common");
  const { error } = await searchParams;

  if (!user.departmentId) {
    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="max-w-xl mx-auto bg-white border-2 border-amber-200 rounded-2xl p-6 space-y-3">
          <h1 className="text-xl font-black text-gray-900">{t("orders.fieldNew.noDepartmentTitle")}</h1>
          <p className="text-sm text-gray-700">
            {t("orders.fieldNew.noDepartmentText")}
          </p>
          <Link href="/mine-oppdrag" className="inline-block bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-bold">
            {t("orders.fieldNew.backToMyWorkOrders")}
          </Link>
        </div>
      </div>
    );
  }

  // Startutvalg for det serverbaserte kundevalget. Resten av registeret søkes
  // det i på serveren, så ingen kunder forsvinner bak en hard 100-grense.
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    take: 20,
    select: {
      id: true,
      name: true,
      city: true,
      customerNumber: true,
    },
  });
  const templates = await prisma.template.findMany({ orderBy: { title: "asc" } });
  const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });

  const errorKey: Record<string, string> = {
    origin: "orders.fieldNew.errorOrigin",
    avdeling: "orders.errors.department",
    "duplikat-ordrenummer": "orders.errors.duplicateOrderNumber",
    "ugyldig-data": "orders.fieldNew.errorInvalidData",
    "rate-limit": "orders.fieldNew.errorRateLimit",
  };
  const errorMessage = error
    ? t(errorKey[error] ?? "orders.errors.generic")
    : undefined;

  return (
    <CreateWorkOrderForm
      customers={customers}
      templates={templates}
      tags={tags}
      error={errorMessage}
    />
  );
}
