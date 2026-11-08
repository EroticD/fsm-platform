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
import { getQuote } from "@/server/quotes";
import QuoteForm from "../../quote-form";
import { updateQuoteAction } from "../../actions";

export default async function EditQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireModulePage("quotes");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.manage")) redirect("/tilbud");

  const { id } = await params;
  const search = await searchParams;
  const result = await getQuote(user, id);
  if (!result.ok) redirect("/tilbud");
  const quote = result.data;
  if (quote.status !== "DRAFT") redirect(`/tilbud/${quote.id}`);

  const t = await getTranslations("common");
  const [customers, contacts, workOrders, contracts, products, departments] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, customerNumber: true },
    }),
    prisma.contact.findMany({
      where: {
        customerId: quote.customerId ?? "",
        customer: { deletedAt: null },
      },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, role: true, customerId: true },
    }),
    prisma.workOrder.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, title: true, reference: true },
    }),
    prisma.contract.findMany({
      orderBy: { title: "asc" },
      take: 100,
      select: { id: true, title: true, customerId: true },
    }),
    prisma.product.findMany({
      orderBy: { model: "asc" },
      take: 100,
      select: { id: true, model: true, customerId: true },
    }),
    user.role === "ADMIN" ? getActiveDepartments() : Promise.resolve([]),
  ]);

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={t("quotes.edit.title")}
          subtitle={quote.title}
          icon={<Icon name="edit" className="h-5 w-5" />}
          actions={
            <Link
              href={`/tilbud/${quote.id}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold"
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("quotes.edit.back")}
            </Link>
          }
        />
        {search.error ? <ErrorBanner message={t("quotes.errors.generic")} /> : null}
        <QuoteForm
          action={updateQuoteAction}
          submitLabel={t("quotes.edit.submit")}
          cancelHref={`/tilbud/${quote.id}`}
          defaults={{
            id: quote.id,
            title: quote.title,
            customerId: quote.customerId ?? "",
            contactId: quote.contactId ?? "",
            workOrderId: quote.workOrderId ?? "",
            contractId: quote.contractId ?? "",
            productId: quote.productId ?? "",
            departmentId: quote.departmentId,
            validUntil: quote.validUntil ? toDateOnly(quote.validUntil) : "",
            vatRate: quote.vatRate.toFixed(2),
            notes: quote.notes ?? "",
            lines: quote.lines.map((line) => ({
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
            contracts,
            products,
            departments,
            isAdmin: user.role === "ADMIN",
          }}
        />
      </div>
    </div>
  );
}
