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
import { toDateOnly } from "@/lib/dates";
import { getInvoice } from "@/server/invoices";
import InvoiceForm from "../../invoice-form";
import { updateInvoiceAction } from "../../actions";

export default async function EditInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireModulePage("invoicing");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.manage")) redirect("/faktura");

  const { id } = await params;
  const search = await searchParams;
  const result = await getInvoice(user, id);
  if (!result.ok) redirect("/faktura");
  const invoice = result.data;
  if (invoice.status !== "DRAFT") redirect(`/faktura/${invoice.id}`);

  const t = await getTranslations("common");
  const [customers, contacts, workOrders, reports, quotes, departments] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, customerNumber: true },
    }),
    prisma.contact.findMany({
      where: {
        customerId: invoice.customerId,
        customer: { deletedAt: null },
      },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, role: true, customerId: true },
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
      select: { id: true, name: true, reportNumber: true, workOrder: { select: { title: true } } },
    }),
    prisma.quote.findMany({
      where: { status: "ACCEPTED" },
      orderBy: { acceptedAt: "desc" },
      take: 200,
      select: { id: true, title: true, quoteNumber: true, customerName: true, customer: { select: { name: true } } },
    }),
    user.role === "ADMIN" ? getActiveDepartments() : Promise.resolve([]),
  ]);

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={t("invoicing.edit.title")}
          subtitle={invoice.invoiceNumber ?? t("invoicing.list.draftNumber")}
          icon={<Icon name="edit" className="h-5 w-5" />}
          actions={
            <Link href={`/faktura/${invoice.id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold">
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("invoicing.edit.back")}
            </Link>
          }
        />
        {search.error ? <ErrorBanner message={t("invoicing.errors.generic")} /> : null}
        <InvoiceForm
          action={updateInvoiceAction}
          submitLabel={t("invoicing.edit.submit")}
          cancelHref={`/faktura/${invoice.id}`}
          defaults={{
            id: invoice.id,
            customerId: invoice.customerId,
            contactId: invoice.contactId ?? "",
            workOrderId: invoice.workOrderId ?? "",
            reportId: invoice.reportId ?? "",
            quoteId: invoice.quoteId ?? "",
            departmentId: invoice.departmentId,
            issueDate: invoice.issueDate ? toDateOnly(invoice.issueDate) : "",
            dueDate: invoice.dueDate ? toDateOnly(invoice.dueDate) : "",
            vatRate: invoice.vatRate.toFixed(2),
            notes: invoice.notes ?? "",
            lines: invoice.lines.map((line) => ({
              description: line.description,
              quantity: line.quantity.toFixed(2),
              unit: line.unit,
              unitPrice: line.unitPrice.toFixed(2),
              vatRate: line.vatRate.toFixed(2),
            })),
          }}
          options={{
            customers,
            contacts: contacts.map((contact) => ({
              id: contact.id,
              name: contact.name,
              role: contact.role,
              customerId: contact.customerId,
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
