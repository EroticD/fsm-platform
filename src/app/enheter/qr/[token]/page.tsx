import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { resolveEquipmentQrToken } from "@/server/equipment";

export const dynamic = "force-dynamic";

/**
 * QR-etiketten peker hit. Et rotert token finnes ikke lenger og gir 404, mens
 * et gyldig token sender innloggede brukere til enhetens side.
 */
export default async function EquipmentQrPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const equipment = await resolveEquipmentQrToken(token);
  if (!equipment) notFound();

  const user = await getCurrentUser();
  if (!user) {
    redirect(
      `/api/auth/signin?callbackUrl=${encodeURIComponent(`/enheter/qr/${token}`)}`,
    );
  }
  if (!hasPermission(user, "equipment.view")) redirect("/");

  redirect(`/enheter/${equipment.id}`);
}
