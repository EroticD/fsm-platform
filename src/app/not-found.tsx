import Link from "next/link";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

/**
 * Merkevaretilpasset 404-side. Den ligger i app-roten, så både innloggede og
 * utloggede får en forklaring på norsk/engelsk i stedet for Next.js' standard
 * engelske «This page could not be found». Fargen kommer fra den samme
 * CSS-variabelen som resten av appen bruker.
 */
export default async function NotFound() {
  const t = await getTranslations("common");

  const branding = await prisma.branding.findFirst().catch(() => null);
  const companyName = branding?.companyName?.trim() || "FSM System";
  const initial = companyName.charAt(0).toUpperCase();

  // 404-siden skal ikke krasje selv om sesjonen eller databasen er midlertidig
  // utilgjengelig. Da viser vi bare de nøytrale lenkene.
  let canViewWorkOrders = false;
  try {
    const user = await getCurrentUser();
    canViewWorkOrders = hasPermission(user, "workorders.view");
  } catch {
    canViewWorkOrders = false;
  }

  return (
    <div className="office-app flex min-h-[60vh] items-center justify-center p-4 sm:p-8">
      <div className="office-card w-full max-w-md p-8 text-center [--focus-ring:var(--ink,#101310)]">
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ink,#101310)] text-2xl font-black text-[var(--paper,#f2efe6)] shadow-[3px_3px_0_var(--signal,#d8ff3e)]"
          aria-hidden="true"
        >
          {initial}
        </div>
        <p className="text-sm font-black uppercase tracking-[0.14em] text-[var(--muted,#62685f)]">
          404
        </p>
        <h1 className="mt-1 text-2xl font-black text-[var(--ink,#101310)]">
          {t("notFound.title")}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted,#62685f)]">
          {t("notFound.description", { companyName })}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="signal-button border border-[var(--ink,#101310)] bg-[var(--signal,#d8ff3e)] text-sm text-[var(--ink,#101310)] shadow-[2px_2px_0_var(--ink,#101310)] transition hover:translate-x-px hover:translate-y-px hover:shadow-[1px_1px_0_var(--ink,#101310)]"
          >
            {t("notFound.dashboard")}
          </Link>
          <Link
            href="/sok"
            className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--line,#dedcd1)] bg-transparent px-5 py-2.5 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
          >
            {t("notFound.search")}
          </Link>
          {canViewWorkOrders && (
            <Link
              href="/oppdrag"
              className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-[var(--line,#dedcd1)] bg-transparent px-5 py-2.5 text-sm font-bold text-[var(--ink,#101310)] transition hover:bg-[var(--paper,#f2efe6)]"
            >
              {t("notFound.workOrders")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
