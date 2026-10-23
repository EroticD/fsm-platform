"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { requireWorkOrderAccess } from "@/lib/access";
import { idSchema } from "@/lib/schemas/common";

/**
 * Sletter et oppdrag med rapporter, kommentarer og vedlegg.
 *
 * Krever `workorders.delete`, og går gjennom `requireWorkOrderAccess` slik at
 * avdelingsgrensen og regelen om kansellerte oppdrag gjelder. Uten dette ville
 * en bruker med slettetilgang i avdeling A kunne slette et oppdrag i avdeling B
 * ved å gjette id-en.
 *
 * Slettingen og revisjonsloggen skrives i samme transaksjon. Da kan ikke
 * oppdraget forsvinne uten at slettingen står i aktivitetsloggen, og en feil i
 * loggen ruller slettingen tilbake.
 */
export async function deleteWorkOrder(formData: FormData) {
  const parsedId = idSchema.safeParse(
    cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line }),
  );
  if (!parsedId.success) redirect("/oppdrag?error=ugyldig-data");
  const workOrderId = parsedId.data;

  const access = await requireWorkOrderAccess("workorders.delete", workOrderId);
  if (!access) redirect("/oppdrag?error=ikke-tilgang");

  const target = await prisma.workOrder.findUnique({
    where: { id: access.workOrder.id },
    select: { title: true, customer: { select: { name: true } } },
  });
  if (!target) redirect("/oppdrag?error=ikke-funnet");

  await prisma.$transaction(async (tx) => {
    await audit(tx, {
      entityType: "WorkOrder",
      entityId: access.workOrder.id,
      action: `Slettet oppdraget «${target.title}»${
        target.customer?.name ? ` (${target.customer.name})` : ""
      } med tilhørende rapporter`,
      actor: {
        id: access.user.id,
        name: access.user.name,
        email: access.user.email,
      },
    });
    await tx.workOrder.delete({ where: { id: access.workOrder.id } });
  });

  revalidatePath("/");
  revalidatePath("/oppdrag");
  revalidatePath("/rapporter");
  revalidatePath("/kalender");
  redirect("/oppdrag");
}
