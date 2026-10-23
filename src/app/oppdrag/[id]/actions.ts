"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { requireWorkOrderAccess } from "@/lib/access";

/**
 * Sletter et oppdrag med rapporter, kommentarer og vedlegg.
 *
 * Krever `workorders.delete`, og går gjennom `requireWorkOrderAccess` slik at
 * avdelingsgrensen og regelen om kansellerte oppdrag gjelder. Uten dette ville
 * en bruker med slettetilgang i avdeling A kunne slette et oppdrag i avdeling B
 * ved å gjette id-en.
 *
 * Slettingen logges før den utføres, slik at den som slettet fortsatt står
 * igjen i aktivitetsloggen etter at oppdraget er borte.
 */
export async function deleteWorkOrder(formData: FormData) {
  const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
  if (!workOrderId) return;

  const access = await requireWorkOrderAccess("workorders.delete", workOrderId);
  if (!access) return;

  const target = await prisma.workOrder.findUnique({
    where: { id: access.workOrder.id },
    select: { title: true, customer: { select: { name: true } } },
  });
  if (!target) return;

  await prisma.auditLog.create({
    data: {
      entityType: "WorkOrder",
      entityId: access.workOrder.id,
      action: `Slettet oppdraget «${target.title}»${
        target.customer?.name ? ` (${target.customer.name})` : ""
      } med tilhørende rapporter`,
      userName: access.user.name || access.user.email || "Administrator",
    },
  });

  await prisma.workOrder.delete({ where: { id: access.workOrder.id } });

  revalidatePath("/");
  revalidatePath("/oppdrag");
  revalidatePath("/rapporter");
  revalidatePath("/kalender");
  redirect("/oppdrag");
}
