import { Suspense } from "react";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import Icon from "@/components/icons";
import DashboardViewSwitch from "./DashboardViewSwitch";
import type { DashboardView } from "./helpers";

async function OrderCount({
  scope,
  visibleStatus,
}: {
  scope: Prisma.WorkOrderWhereInput;
  visibleStatus: Prisma.WorkOrderWhereInput;
}) {
  const t = await getTranslations("common");
  const count = await prisma.workOrder.count({
    where: {
      AND: [
        scope,
        visibleStatus,
        { status: { notIn: ["COMPLETED", "CANCELLED"] } },
      ],
    },
  });

  return (
    <span className="font-bold tabular-nums">
      {t("dashboard.header.orderCount", { count })}
    </span>
  );
}

export default function DashboardHeader({
  view,
  week,
  fullDate,
  dateIso,
  listHref,
  boardHref,
  newOrderHref,
  canCreate,
  scope,
  visibleStatus,
  t,
}: {
  view: DashboardView;
  week: number | null;
  fullDate: string;
  dateIso: string;
  listHref: string;
  boardHref: string;
  newOrderHref: string;
  canCreate: boolean;
  scope: Prisma.WorkOrderWhereInput;
  visibleStatus: Prisma.WorkOrderWhereInput;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <header className="flex flex-col gap-5 pb-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-black uppercase tracking-[0.16em] text-[var(--muted,#62685f)]">
          <span
            aria-hidden
            className="inline-block h-2 w-2 bg-[var(--ink,#101310)]"
          />
          <span>{t("dashboard.planningEyebrow")}</span>
          {week ? (
            <>
              <span aria-hidden>·</span>
              <span>{t("dashboard.weekLabel", { week })}</span>
            </>
          ) : null}
        </p>

        <h1 className="mt-1 flex items-start gap-2 text-5xl font-black leading-[0.95] tracking-[-0.055em] text-[var(--ink,#101310)] sm:text-6xl">
          <span>{t("dashboard.planningTitle")}</span>
          <span
            aria-hidden
            className="mt-2 h-3 w-3 shrink-0 rounded-full bg-[var(--signal,#d8ff3e)] ring-1 ring-[var(--ink,#101310)] sm:mt-2.5 sm:h-3.5 sm:w-3.5"
          />
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-[var(--ink,#101310)] sm:text-sm">
          <time dateTime={dateIso} className="first-letter:uppercase">
            {fullDate}
          </time>
          <span aria-hidden className="text-[var(--line,#dedcd1)]">
            ·
          </span>
          <Suspense
            fallback={
              <span
                aria-hidden
                className="inline-block h-3 w-16 animate-pulse rounded-full bg-[var(--line,#dedcd1)] align-middle"
              />
            }
          >
            <OrderCount scope={scope} visibleStatus={visibleStatus} />
          </Suspense>
          <span aria-hidden className="text-[var(--line,#dedcd1)]">
            ·
          </span>
          <span className="inline-flex items-center gap-1.5 text-[#3f4a1a]">
            <span
              aria-hidden
              className="h-2 w-2 rounded-full bg-[var(--signal,#d8ff3e)] ring-1 ring-[var(--ink,#101310)]"
            />
            {t("dashboard.header.live")}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <DashboardViewSwitch
          view={view}
          listHref={listHref}
          boardHref={boardHref}
          listLabel={t("dashboard.header.viewList")}
          boardLabel={t("dashboard.header.viewBoard")}
          ariaLabel={t("dashboard.header.viewLabel")}
        />
        {canCreate ? (
          <Link
            href={newOrderHref}
            className="signal-button min-h-11 px-4 text-sm shadow-[3px_3px_0_var(--ink,#101310)] hover:shadow-[1px_1px_0_var(--ink,#101310)]"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--ink,#101310)] text-[var(--signal,#d8ff3e)]">
              <Icon name="plus" className="h-4 w-4" />
            </span>
            {t("dashboard.quickActions.newWorkOrder")}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
