"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  releaseAuditHold,
  saveAuditRetention,
  setAuditHold,
} from "@/server/audit-retention";

const BASE = "/innstillinger?tab=auditlog";

async function currentActor() {
  const actor = await getCurrentUser();
  if (!actor) redirect("/");
  return actor;
}

/** Lagrer revisjonsloggens oppbevaringstid. Tjenestelaget krever administrator. */
export async function saveAuditRetentionAction(formData: FormData) {
  const actor = await currentActor();
  const result = await saveAuditRetention(
    actor,
    formData.get("retentionDays"),
  );
  revalidatePath("/innstillinger");
  redirect(
    result.ok
      ? `${BASE}&ok=retention`
      : `${BASE}&error=retention`,
  );
}

/** Setter bevaringsplikt på en revisjonsrad eller en entitet. */
export async function setAuditHoldAction(formData: FormData) {
  const actor = await currentActor();
  const result = await setAuditHold(actor, {
    auditLogId: String(formData.get("auditLogId") ?? ""),
    entityType: String(formData.get("entityType") ?? ""),
    entityId: String(formData.get("entityId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  revalidatePath("/innstillinger");
  redirect(result.ok ? `${BASE}&ok=hold` : `${BASE}&error=hold`);
}

/** Opphever et hold. Historikken endres ikke. */
export async function releaseAuditHoldAction(formData: FormData) {
  const actor = await currentActor();
  const result = await releaseAuditHold(
    actor,
    String(formData.get("holdId") ?? ""),
  );
  revalidatePath("/innstillinger");
  redirect(result.ok ? `${BASE}&ok=hold-released` : `${BASE}&error=hold`);
}
