"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { LIMITS, cleanText } from "@/lib/sanitize";
import { getCurrentUser } from "@/lib/session";

/**
 * Sletter et oppdrag med rapporter, kommentarer og vedlegg.
 *
 * Bare administrator: dette fjerner også signerte rapporter, som er
 * dokumentasjon på utført arbeid. Rapporter, rapportenheter, kommentarer og
 * vedlegg forsvinner sammen med oppdraget (onDelete: Cascade i schema.prisma).
 *
 * Slettingen logges før den utføres, slik at den som slettet fortsatt står
 * igjen i aktivitetsloggen etter at oppdraget er borte.
 */
export async function deleteWorkOrder(formData: FormData) {
  const actor = await getCurrentUser();
  if (actor?.role !== "ADMIN") return;

  const workOrderId = cleanText(formData.get("workOrderId"), { maxLength: LIMITS.line });
  if (!workOrderId) return;

  const target = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { title: true, customer: { select: { name: true } } },
  });
  if (!target) return;

  await prisma.auditLog.create({
    data: {
      entityType: "WorkOrder",
      entityId: workOrderId,
      action: `Slettet oppdraget «${target.title}»${
        target.customer?.name ? ` (${target.customer.name})` : ""
      } med tilhørende rapporter`,
      userName: actor.name || actor.email || "Administrator",
    },
  });

  await prisma.workOrder.delete({ where: { id: workOrderId } });

  revalidatePath("/");
  revalidatePath("/oppdrag");
  revalidatePath("/rapporter");
  revalidatePath("/kalender");
  redirect("/oppdrag");
}
