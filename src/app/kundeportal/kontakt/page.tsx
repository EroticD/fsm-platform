import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import PortalShell from "@/components/portal/PortalShell";
import ContactUpdateForm from "@/components/portal/ContactUpdateForm";
import { brandCard, brandInset } from "@/components/ui/brandStyles";
import { getPortalSites } from "@/server/portal-expansion";
import { PortalNoAccess, loadPortalPage } from "../portal-page";

export default async function PortalContactPage() {
  const context = await loadPortalPage();
  if (!context) return <PortalNoAccess />;
  const t = await getTranslations("common");

  const [customer, sitesResult] = await Promise.all([
    prisma.customer.findFirst({
      where: { id: context.access.customerId, deletedAt: null },
      select: {
        address: true,
        postalCode: true,
        city: true,
        phone: true,
        email: true,
        department: {
          select: {
            name: true,
            address: true,
            postalCode: true,
            city: true,
            phone: true,
            email: true,
          },
        },
        responsibleTechnician: {
          select: { name: true, phone: true, email: true },
        },
      },
    }),
    getPortalSites(context.user),
  ]);
  const sites = sitesResult.ok ? sitesResult.data : [];

  return (
    <PortalShell
      active="kontakt"
      customer={context.customer}
      userName={context.user.name ?? context.user.email ?? ""}
    >
      <section className={`${brandCard} p-4 sm:p-5`}>
        <h2 className="text-lg font-extrabold tracking-tight">
          {t("portal.contact.title")}
        </h2>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className={`${brandInset} min-w-0 p-3`}>
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted,#62685f)]">
              {customer?.department
                ? t("portal.contact.department")
                : t("portal.contact.company")}
            </p>
            <p className="break-words text-sm font-bold">
              {customer?.department?.name || context.customer.name}
            </p>
            <p className="mt-1 break-words text-sm leading-6 text-[var(--muted,#62685f)]">
              {customer?.department?.address ||
                customer?.address ||
                t("portal.contact.notProvided")}
              {customer?.department?.postalCode || customer?.postalCode
                ? `, ${customer?.department?.postalCode || customer?.postalCode}`
                : ""}
              {customer?.department?.city || customer?.city
                ? ` ${customer?.department?.city || customer?.city}`
                : ""}
            </p>
            {(customer?.department?.phone || customer?.phone) && (
              <p className="mt-1 text-sm">
                <a
                  href={`tel:${customer?.department?.phone || customer?.phone}`}
                  className="font-bold underline decoration-2 underline-offset-4"
                >
                  {customer?.department?.phone || customer?.phone}
                </a>
              </p>
            )}
            {(customer?.department?.email || customer?.email) && (
              <p className="break-words text-sm">
                <a
                  href={`mailto:${customer?.department?.email || customer?.email}`}
                  className="font-bold underline decoration-2 underline-offset-4"
                >
                  {customer?.department?.email || customer?.email}
                </a>
              </p>
            )}
          </div>

          <div className={`${brandInset} min-w-0 p-3`}>
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted,#62685f)]">
              {t("portal.contact.responsible")}
            </p>
            {customer?.responsibleTechnician ? (
              <>
                <p className="text-sm font-bold">
                  {customer.responsibleTechnician.name}
                </p>
                {customer.responsibleTechnician.phone && (
                  <p className="mt-1 text-sm">
                    <a
                      href={`tel:${customer.responsibleTechnician.phone}`}
                      className="font-bold underline decoration-2 underline-offset-4"
                    >
                      {customer.responsibleTechnician.phone}
                    </a>
                  </p>
                )}
                {customer.responsibleTechnician.email && (
                  <p className="break-words text-sm">
                    <a
                      href={`mailto:${customer.responsibleTechnician.email}`}
                      className="font-bold underline decoration-2 underline-offset-4"
                    >
                      {customer.responsibleTechnician.email}
                    </a>
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-[var(--muted,#62685f)]">
                {t("portal.contact.noResponsible")}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-extrabold uppercase tracking-[0.1em] text-[var(--muted,#62685f)]">
            {t("portal.expansion.contact.sitesTitle")}
          </h3>
          {sites.length === 0 ? (
            <p className="mt-2 text-sm italic text-[var(--muted,#62685f)]">
              {t("portal.expansion.contact.noSites")}
            </p>
          ) : (
            <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sites.map((site) => (
                <li key={site.id} className={`${brandInset} min-w-0 p-3`}>
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    {site.name}
                    {site.isPrimary && (
                      <span className="rounded-full bg-[var(--signal,#d8ff3e)] px-2 py-0.5 text-xs font-bold text-[var(--ink,#101310)]">
                        {t("portal.expansion.contact.primary")}
                      </span>
                    )}
                  </p>
                  <p className="break-words text-xs leading-5 text-[var(--muted,#62685f)]">
                    {[site.address, site.postalCode, site.city]
                      .filter(Boolean)
                      .join(", ") || t("portal.contact.notProvided")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 border-t border-[var(--line,#dedcd1)] pt-4">
          <ContactUpdateForm />
        </div>
      </section>
    </PortalShell>
  );
}
