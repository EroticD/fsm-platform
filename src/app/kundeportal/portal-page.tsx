import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import {
  resolvePortalAccess,
  type PortalAccess,
} from "@/server/portal-access";

export type PortalPageContext = {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
  access: PortalAccess;
  customer: {
    id: string;
    name: string;
    brandColor: string | null;
    logoUrl: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    postalCode: string | null;
    city: string | null;
  };
};

/**
 * Felles oppstart for portalens sider. Siden avgjør selv hvilke data den
 * henter, men identitet, kunde og delegasjon resolves alltid på nytt.
 */
export async function loadPortalPage(): Promise<PortalPageContext | null> {
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  const access = await resolvePortalAccess(user);
  if (!access.ok) return null;

  const customer = await prisma.customer.findFirst({
    where: { id: access.data.customerId, deletedAt: null },
    select: {
      id: true,
      name: true,
      brandColor: true,
      logoUrl: true,
      phone: true,
      email: true,
      address: true,
      postalCode: true,
      city: true,
    },
  });
  if (!customer) return null;
  return { user, access: access.data, customer };
}

export async function PortalNoAccess() {
  const { getTranslations } = await import("next-intl/server");
  const t = await getTranslations("common");
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas,#f4f5f2)] p-4 text-[var(--ink,#101310)]">
      <div className="w-full max-w-md rounded-card border border-[var(--line,#dedcd1)] bg-[var(--surface,#fffdf8)] p-8 text-center shadow-[0_1px_2px_rgba(20,17,11,0.05)]">
        <span
          aria-hidden="true"
          className="mx-auto mb-4 block h-1 w-10 rounded-full bg-[var(--risk,#f04427)]"
        />
        <h1 className="mb-2 text-2xl font-extrabold tracking-tight text-[#a92a12]">
          {t("portal.noAccessTitle")}
        </h1>
        <p className="text-sm leading-6 text-[var(--muted,#62685f)]">
          {t("portal.noAccessDesc")}
        </p>
      </div>
    </div>
  );
}
