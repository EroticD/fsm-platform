import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import prisma from "@/lib/prisma";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import PageShell from "@/components/PageShell";
import { buttonClassName } from "@/components/ui/Button";
import ErrorBanner from "@/components/ErrorBanner";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getActiveDepartments } from "@/lib/departments";
import { addDaysUtc, todayUtc, toDateOnly } from "@/lib/dates";
import { getBillingSettings } from "@/server/invoices";
import InvoiceForm from "../invoice-form";
import { createInvoiceAction } from "../actions";
import { invoiceErrorKey } from "../feedback";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireModulePage("invoicing");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.manage")) redirect("/faktura");

  const t = await getTranslations("common");
  const params = await searchParams;
  const settings = await getBillingSettings();
  const [customers, workOrders, reports, quotes, departments] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, customerNumber: true },
    }),
    prisma.workOrder.findMany({
      where: { deletedAt: null, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, title: true, reference: true },
    }),
    prisma.report.findMany({
      where: { deletedAt: null, workOrder: { status: "COMPLETED" } },
      orderBy: { completedAt: "desc" },
      take: 200,
      select: {
        id: true,
        name: true,
        reportNumber: true,
        workOrder: { select: { title: true } },
      },
    }),
    prisma.quote.findMany({
      where: { status: "ACCEPTED" },
      orderBy: { acceptedAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        quoteNumber: true,
        customerName: true,
        customer: { select: { name: true } },
      },
    }),
    user.role === "ADMIN" ? getActiveDepartments() : Promise.resolve([]),
  ]);

  const issueDate = toDateOnly(todayUtc());
  const dueDate = toDateOnly(addDaysUtc(todayUtc(), settings.invoiceDueDays));

  return (
    <PageShell size="narrow">
      <PageHeader
        title={t("invoicing.new.title")}
        subtitle={t("invoicing.new.subtitle")}
        icon={<Icon name="plus" className="h-5 w-5" />}
        actions={
          <Link href="/faktura" className={buttonClassName({ variant: "secondary" })}>
            <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
            {t("invoicing.new.back")}
          </Link>
        }
      />
      {params.error ? (
        <ErrorBanner message={t(invoiceErrorKey(params.error) ?? "invoicing.errors.generic")} />
      ) : null}
      <InvoiceForm
        action={createInvoiceAction}
        submitLabel={t("invoicing.new.submit")}
        cancelHref="/faktura"
        defaults={{
          customerId: "",
          contactId: "",
          workOrderId: "",
          reportId: "",
          quoteId: "",
          departmentId: user.departmentId ?? "",
          issueDate,
          dueDate,
          vatRate: settings.vatRate.toFixed(2),
          notes: "",
          lines: [],
        }}
        options={{
          customers,
          contacts: [],
          workOrders,
          reports: reports.map((report) => ({
            id: report.id,
            name: report.name,
            reportNumber: report.reportNumber,
            workOrderTitle: report.workOrder.title,
          })),
          quotes: quotes.map((quote) => ({
            id: quote.id,
            title: quote.title,
            quoteNumber: quote.quoteNumber,
            customerName: quote.customer?.name ?? quote.customerName ?? "",
          })),
          departments,
          isAdmin: user.role === "ADMIN",
        }}
      />
    </PageShell>
  );
}
