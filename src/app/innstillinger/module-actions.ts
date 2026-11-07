"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { setModuleEnabled } from "@/server/modules";

const MODULES_PATH = "/innstillinger?tab=moduler";

function modulesHref(params: Record<string, string>) {
  return `${MODULES_PATH}&${new URLSearchParams(params).toString()}`;
}

/**
 * Slår en modul på/av. Server action er en egen POST, så den sjekker
 * administrator og avhengigheter på nytt i tjenestelaget – ikke bare i UI.
 */
export async function setModuleEnabledAction(formData: FormData) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/api/auth/signin");

  const key = String(formData.get("key") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  const result = await setModuleEnabled(actor, key, enabled);

  if (!result.ok) {
    const code =
      result.details &&
      typeof result.details === "object" &&
      "code" in result.details &&
      typeof (result.details as { code?: unknown }).code === "string"
        ? (result.details as { code: string }).code.replace("module.", "")
        : result.reason;
    redirect(modulesHref({ error: code }));
  }

  revalidatePath("/", "layout");
  revalidatePath("/innstillinger");
  redirect(modulesHref({ ok: "saved" }));
}
