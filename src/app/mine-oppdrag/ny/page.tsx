import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import Icon from "@/components/icons";
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
      <div className="field-app flex min-h-screen items-center justify-center p-4 sm:p-6">
        <div className="field-card w-full max-w-md p-5 sm:p-6">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-risk/40 bg-risk/10 text-signal">
            <Icon name="alert" className="h-5 w-5" />
          </span>
          <h1 className="text-xl font-black text-paper">
            {t("orders.fieldNew.noDepartmentTitle")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-paper/70">
            {t("orders.fieldNew.noDepartmentText")}
          </p>
          <Link href="/mine-oppdrag" className="signal-button mt-4 w-full">
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("orders.fieldNew.backToMyWorkOrders")
              .replace(/^[^\p{L}\p{N}]+/u, "")
              .trim()}
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
