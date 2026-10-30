"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  createApiKey,
  revokeApiKey,
  type ApiKeyError,
} from "@/server/api-keys";

const API_KEYS_PATH = "/innstillinger?tab=api";

export type ApiKeyActionState = {
  status: "idle" | "created" | "error";
  /** Klarteksttokenet finnes bare i denne returverdien – aldri i URL eller base. */
  token?: string;
  keyName?: string;
  error?: ApiKeyError;
};

function revalidateApiKeys() {
  revalidatePath("/innstillinger");
}

function revokeErrorPath(error: ApiKeyError): string {
  return `${API_KEYS_PATH}&error=${encodeURIComponent(error)}`;
}

/**
 * Oppretter en nøkkel for den innloggede administratoren. Tjenesten gjør den
 * faktiske autorisasjonen; denne handlingen er bare en tynn oversetter mellom
 * skjemaet og tjenestelaget. Tokenet returneres i action-state og vises én gang
 * i klienten – det skrives aldri til URL, cookie eller database i klartekst.
 */
export async function createApiKeyAction(
  _previous: ApiKeyActionState,
  formData: FormData,
): Promise<ApiKeyActionState> {
  const actor = await getCurrentUser();
  if (!actor) return { status: "error", error: "forbidden" };

  const rawExpiry = String(formData.get("expiresAt") ?? "").trim();
  // Datoen fra <input type="date"> gjelder hele valgte dag. Sett utløpet til
  // slutten av dagen, ikke midnatt, så nøkkelen ikke dør før dagen er over.
  const expiresAt = rawExpiry ? `${rawExpiry}T23:59:59.999Z` : undefined;

  const result = await createApiKey(actor, {
    name: formData.get("name"),
    expiresAt,
  });

  if (!result.ok) {
    return { status: "error", error: result.error };
  }

  revalidateApiKeys();
  return {
    status: "created",
    token: result.token,
    keyName: result.key.name,
  };
}

/**
 * Tilbakekaller en nøkkel. Selve raden beholdes for sporbarhet, men alle
 * videre API-kall med nøkkelen avvises umiddelbart.
 */
export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const actor = await getCurrentUser();
  if (!actor) redirect("/");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect(revokeErrorPath("validation_error"));

  const result = await revokeApiKey(actor, id);
  if (!result.ok) redirect(revokeErrorPath(result.error));

  revalidateApiKeys();
}
