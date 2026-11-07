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
import QuoteForm from "../quote-form";
import { createQuoteAction } from "../actions";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireModulePage("quotes");
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.manage")) redirect("/tilbud");

  const t = await getTranslations("common");
  const params = await searchParams;
  const settings = await getBillingSettings();
  const [customers, contacts, workOrders, contracts, products, departments] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, customerNumber: true },
    }),
    prisma.contact.findMany({
      orderBy: { name: "asc" },
      take: 500,
      select: {
        id: true,
        name: true,
        customerId: true,
        customer: { select: { name: true } },
      },
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

  const validUntil = toDateOnly(addDaysUtc(todayUtc(), settings.quoteValidityDays));
  const errorMessage = params.error ? t("quotes.errors.generic") : null;

  return (
    <div className="office-app min-h-screen p-3 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={t("quotes.new.title")}
          subtitle={t("quotes.new.subtitle")}
          icon={<Icon name="plus" className="h-5 w-5" />}
          actions={
            <Link
              href="/tilbud"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] border border-[var(--ink,#101310)] px-3 py-2 text-xs font-bold"
            >
              <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
              {t("quotes.new.back")}
            </Link>
          }
        />
        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
        <QuoteForm
          action={createQuoteAction}
          submitLabel={t("quotes.new.submit")}
          cancelHref="/tilbud"
          defaults={{
            title: "",
            customerId: "",
            contactId: "",
            workOrderId: "",
            contractId: "",
            productId: "",
            departmentId: user.departmentId ?? "",
            validUntil,
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
