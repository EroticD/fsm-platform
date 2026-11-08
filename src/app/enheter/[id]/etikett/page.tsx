import { requireModulePage } from "@/lib/module-guards";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import QRCode from "qrcode";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { formatDateLocalized } from "@/lib/dates";
import { getEquipment } from "@/server/equipment";
import Icon from "@/components/icons";
import PageShell from "@/components/PageShell";
import Card from "@/components/ui/Card";
import { buttonClassName } from "@/components/ui/Button";
import PrintButton from "@/components/equipment/PrintButton";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("assets.label.title") };
}

async function absoluteAppUrl(): Promise<string> {
  const configured = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "").replace(
    /\/$/,
    "",
  );
  if (configured) return configured;
  const headerStore = await headers();
  const host =
    headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost";
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export default async function EquipmentLabelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModulePage("equipment");
  const t = await getTranslations("common");
  const locale = await getLocale();
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/signin");
  if (!hasPermission(user, "equipment.view")) redirect("/enheter");

  const { id } = await params;
  const result = await getEquipment(user, id);
  if (!result.ok) notFound();

  const { equipment } = result.data;
  const department = equipment.customer.departmentId
    ? await prisma.department.findUnique({
        where: { id: equipment.customer.departmentId },
        select: { phone: true },
      })
    : null;

  const baseUrl = await absoluteAppUrl();
  const qrValue = equipment.qrToken
    ? `${baseUrl}/enheter/qr/${equipment.qrToken}`
    : null;
  const qrDataUrl = qrValue
    ? await QRCode.toDataURL(qrValue, { margin: 1, width: 420 })
    : null;

  return (
    <PageShell size="narrow">
      <style>{`
        @page { size: A6; margin: 8mm; }
        @media print {
          .label-toolbar { display: none !important; }
          .label-sheet { box-shadow: none !important; border: 0 !important; }
          .office-app { background: white !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="label-toolbar flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/enheter/${equipment.id}`}
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          <Icon name="arrowRight" className="h-4 w-4 rotate-180" />
          {t("assets.label.back")}
        </Link>
        <PrintButton />
      </div>

      <Card
        as="article"
        className="label-sheet mx-auto w-full max-w-[420px] p-4 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink pb-3">
          <div className="min-w-0">
            <p className="type-eyebrow text-muted">{t("assets.label.title")}</p>
            <h1 className="mt-1 break-words text-xl font-black leading-tight text-ink">
              {equipment.model}
            </h1>
          </div>
          <Icon name="wrench" className="h-6 w-6 shrink-0" />
        </div>

        {qrDataUrl ? (
          <div className="mt-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={t("assets.label.scan")}
              width={140}
              height={140}
              className="h-[140px] w-[140px] shrink-0 border border-line bg-white p-1"
            />
            <dl className="min-w-0 flex-1 space-y-1 text-xs">
              <div>
                <dt className="font-bold uppercase tracking-[0.08em] text-muted">
                  {t("assets.detail.customer")}
                </dt>
                <dd className="break-words font-bold">{equipment.customer.name}</dd>
              </div>
              <div>
                <dt className="font-bold uppercase tracking-[0.08em] text-muted">
                  {t("assets.detail.serial")}
                </dt>
                <dd className="break-all font-mono">
                  {equipment.serialNumber || t("assets.detail.noSerial")}
                </dd>
              </div>
              {equipment.location && (
                <div>
                  <dt className="font-bold uppercase tracking-[0.08em] text-muted">
                    {t("assets.detail.location")}
                  </dt>
                  <dd className="break-words">{equipment.location}</dd>
                </div>
              )}
              <div>
                <dt className="font-bold uppercase tracking-[0.08em] text-muted">
                  {t("assets.detail.warrantyUntil")}
                </dt>
                <dd>
                  {equipment.warrantyUntil
                    ? formatDateLocalized(equipment.warrantyUntil, locale)
                    : t("assets.detail.warrantyNone")}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-[var(--risk,#f04427)] bg-[var(--risk-surface,#fdf4f2)] p-3 text-xs font-bold text-[var(--risk-text,#b42318)]"
          >
            {t("assets.label.noQr")}
          </p>
        )}

        <div className="mt-3 border-t border-line pt-2 text-xs">
          {department?.phone && (
            <p className="font-bold">
              {t("assets.label.servicePhone", { phone: department.phone })}
            </p>
          )}
          <p className="mt-1 text-muted">{t("assets.label.footer")}</p>
        </div>
      </Card>
    </PageShell>
  );
}
