import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import prisma from "@/lib/prisma";
import Icon from "@/components/icons";
import PageHeader from "@/components/PageHeader";
import ErrorBanner from "@/components/ErrorBanner";
import { requireModulePage } from "@/lib/module-guards";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { getActiveDepartments } from "@/lib/departments";
import { addDaysUtc, todayUtc, toDateOnly } from "@/lib/dates";
import { getBillingSettings } from "@/server/invoices";
import InvoiceForm from "../invoice-form";
import { createInvoiceAction } from "../actions";

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
  const [customers, contacts, workOrders, reports, quotes, departments] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, customerNumber: true },
    }),
    prisma.contact.findMany({
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, customerId: true, customer: { select: { name: true } } },
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
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={t("invoicing.new.title")}
          subtitle={t("invoicing.new.subtitle")}
          icon={<Icon name="plus" className="h-5 w-5" />}
          actions={
            <Link href="/faktura" className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold">
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("invoicing.new.back")}
            </Link>
          }
        />
        {params.error ? <ErrorBanner message={t("invoicing.errors.generic")} /> : null}
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
            contacts: contacts.map((contact) => ({
              id: contact.id,
              name: contact.name,
              customerId: contact.customerId,
              customerName: contact.customer.name,
            })),
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
      </div>
    </div>
  );
}
