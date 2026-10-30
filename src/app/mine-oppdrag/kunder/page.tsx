import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import GoogleMapsLink from "@/components/GoogleMapsLink";
import Icon from "@/components/icons";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { searchNormalizedIds } from "@/lib/search-sql";

export default async function TechnicianCustomerLookupPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "customers.view")) redirect("/");

  const t = await getTranslations("common");
  const resolvedParams = await searchParams;
  const searchQuery = resolvedParams.q ? resolvedParams.q.trim() : "";

  let customers: any[] = [];

  if (searchQuery.length > 0) {
    // Samme normaliserte kundesøk som kundelisten og kundevelgeren: navn,
    // kundenummer, org.nr, telefon, e-post, adresse, postnummer, sted og
    // notater. Det gjør telefon/org.nr med mellomrom og tegnsetting søkbare.
    const hits = await searchNormalizedIds("Customer", searchQuery, 20);
    const ids = hits.map((hit) => hit.id);

    customers = ids.length === 0
      ? []
      : await prisma.customer.findMany({
          where: { deletedAt: null, id: { in: ids } },
          include: {
            contacts: true,
            products: true,
          },
          take: 20,
        });
  } else {
    customers = await prisma.customer.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      include: {
        contacts: true,
        products: true,
      },
      take: 10
    });
  }

  return (
    <div className="field-app min-h-screen p-4 pb-32 sm:p-6 sm:pb-12">
      <div className="mx-auto max-w-3xl space-y-5">
        {/* TOPPTEKST OG TILBAKE */}
        <div className="flex flex-col justify-between gap-3 border-b border-[#2a3328] pb-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black text-[var(--paper,#f2efe6)]">
              <Icon name="users" className="h-6 w-6 shrink-0" strokeWidth={2} />
              {t("orders.fieldCustomers.title")}
            </h1>
            <p className="mt-1 text-sm text-[var(--paper,#f2efe6)]/70">
              {t("orders.fieldCustomers.subtitle")}
            </p>
          </div>
          <Link
            href="/mine-oppdrag"
            className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-xl border border-[#2a3328] bg-[var(--field-card,#151a14)] px-4 py-2 text-sm font-bold text-[var(--paper,#f2efe6)]/85 transition hover:bg-[var(--paper,#f2efe6)]/10"
          >
            {t("orders.fieldCustomers.backToMyWorkOrders")}
          </Link>
        </div>

        {/* SØKEFELT */}
        <form method="GET" action="/mine-oppdrag/kunder" className="flex gap-2">
          <input
            type="text"
            name="q"
            aria-label={t("orders.fieldCustomers.search")}
            defaultValue={searchQuery}
            placeholder={t("orders.fieldCustomers.searchPlaceholder")}
            className="min-h-11 w-full rounded-xl border border-[#2a3328] bg-[var(--field-card,#151a14)] px-4 py-3 text-sm font-medium text-[var(--paper,#f2efe6)] outline-none transition focus:border-[var(--signal,#d8ff3e)] focus:ring-2 focus:ring-[var(--signal,#d8ff3e)] [--focus-ring:var(--signal,#d8ff3e)]"
          />
          <button type="submit" className="signal-button shrink-0 px-5 text-sm">
            {t("orders.fieldCustomers.search")}
          </button>
          {searchQuery && (
            <Link
              href="/mine-oppdrag/kunder"
              aria-label={t("orders.fieldCustomers.clear")}
              title={t("orders.fieldCustomers.clear")}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-[#2a3328] bg-[var(--field-card,#151a14)] text-[var(--paper,#f2efe6)] transition hover:bg-[var(--paper,#f2efe6)]/10"
            >
              <Icon name="close" className="h-4 w-4" />
            </Link>
          )}
        </form>

        {/* RESULTATER */}
        <div className="space-y-3">
          {customers.length === 0 ? (
            <div className="field-sheet p-8 text-center">
              <Icon name="search" className="mx-auto h-6 w-6 text-[var(--muted,#62685f)]" />
              <p className="mt-2 text-sm text-[var(--muted,#62685f)]">
                {t("orders.fieldCustomers.noCustomers")}
              </p>
            </div>
          ) : (
            customers.map((c: any) => (
              <div key={c.id} className="field-sheet space-y-3 p-4">
                <div className="flex flex-col justify-between gap-2 border-b border-[var(--line,#dedcd1)] pb-3 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-[var(--ink,#101310)]">{c.name}</h2>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--muted,#62685f)]">
                      <GoogleMapsLink
                        address={c.address}
                        postalCode={c.postalCode}
                        city={c.city}
                        label={c.address || t("orders.fieldCustomers.noAddress")}
                        className="font-bold text-[var(--ink,#101310)]! underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                      />
                      {c.customerNumber ? ` • ${t("orders.fieldCustomers.customerNumber", { number: c.customerNumber })}` : ""}
                    </p>
                  </div>
                  {c.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] px-3 py-1.5 text-xs font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
                    >
                      <Icon name="phone" className="h-4 w-4 shrink-0" />
                      {t("orders.fieldCustomers.call", { phone: c.phone })}
                    </a>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                  {/* Kontaktpersoner */}
                  <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted,#62685f)]">
                      {t("orders.fieldCustomers.contacts")}
                    </p>
                    {c.contacts.length === 0 ? (
                      <p className="text-xs italic text-[var(--muted,#62685f)]">
                        {t("orders.fieldCustomers.noContacts")}
                      </p>
                    ) : (
                      c.contacts.map((contact: any) => (
                        <div
                          key={contact.id}
                          className="flex flex-wrap items-center justify-between gap-1 border-b border-[var(--line,#dedcd1)] py-1 text-xs last:border-b-0"
                        >
                          <span>
                            <span className="font-bold text-[var(--ink,#101310)]">{contact.name}</span>{" "}
                            <span className="text-[var(--muted,#62685f)]">
                              ({contact.role || t("orders.fieldCustomers.contactFallback")})
                            </span>
                          </span>
                          {contact.phone && (
                            <a
                              href={`tel:${contact.phone}`}
                              className="inline-flex min-h-11 items-center gap-1.5 font-bold text-[var(--ink,#101310)] underline decoration-[var(--signal,#d8ff3e)] decoration-2 underline-offset-4"
                            >
                              <Icon name="phone" className="h-3.5 w-3.5 shrink-0" />
                              {contact.phone}
                            </a>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Utstyr / Maskiner */}
                  <div className="rounded-xl border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-3">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--muted,#62685f)]">
                      {t("orders.fieldCustomers.equipment")}
                    </p>
                    {c.products.length === 0 ? (
                      <p className="text-xs italic text-[var(--muted,#62685f)]">
                        {t("orders.fieldCustomers.noEquipment")}
                      </p>
                    ) : (
                      c.products.map((prod: any) => (
                        <div
                          key={prod.id}
                          className="flex flex-wrap items-baseline gap-1 border-b border-[var(--line,#dedcd1)] py-1 text-xs last:border-b-0"
                        >
                          <span className="font-bold text-[var(--ink,#101310)]">{prod.model}</span>
                          <span className="font-mono text-[var(--muted,#62685f)]">
                            (SN: {prod.serialNumber || "-"})
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
