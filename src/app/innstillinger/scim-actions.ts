"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { moduleEnabled } from "@/server/modules";
import {
  createScimToken,
  revokeScimToken,
  rotateScimToken,
  type ScimTokenError,
} from "@/server/scim-tokens";

const SCIM_PATH = "/innstillinger?tab=sso";

export type ScimTokenActionState = {
  status: "idle" | "created" | "error";
  /** Klarteksttokenet finnes bare i denne returverdien – aldri i URL eller base. */
  token?: string;
  tokenName?: string;
  error?: ScimTokenError;
};

function revalidateScim() {
  revalidatePath("/innstillinger");
}

function errorPath(error: ScimTokenError): string {
  return `${SCIM_PATH}&error=${encodeURIComponent(error)}`;
}

/**
 * Oppretter et SCIM-token. Tjenestelaget krever administrator; denne
 * handlingen er bare en tynn oversetter mellom skjemaet og tjenesten.
 */
export async function createScimTokenAction(
  _previous: ScimTokenActionState,
  formData: FormData,
): Promise<ScimTokenActionState> {
  if (!(await moduleEnabled("sso"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) return { status: "error", error: "forbidden" };

  const rawExpiry = String(formData.get("expiresAt") ?? "").trim();
  // Datoen fra <input type="date"> gjelder hele valgte dag.
  const expiresAt = rawExpiry ? `${rawExpiry}T23:59:59.999Z` : undefined;

  const result = await createScimToken(actor, {
    name: formData.get("name"),
    expiresAt,
  });

  if (!result.ok) return { status: "error", error: result.error };

  revalidateScim();
  return {
    status: "created",
    token: result.token,
    tokenName: result.scimToken.name,
  };
}

/** Roterer et token; det gamle tilbakekalles i samme transaksjon. */
export async function rotateScimTokenAction(
  _previous: ScimTokenActionState,
  formData: FormData,
): Promise<ScimTokenActionState> {
  if (!(await moduleEnabled("sso"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) return { status: "error", error: "forbidden" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { status: "error", error: "validation_error" };

  const result = await rotateScimToken(actor, id);
  if (!result.ok) return { status: "error", error: result.error };

  revalidateScim();
  return {
    status: "created",
    token: result.token,
    tokenName: result.scimToken.name,
  };
}

/** Tilbakekaller et token. Raden beholdes for sporbarhet. */
export async function revokeScimTokenAction(formData: FormData): Promise<void> {
  if (!(await moduleEnabled("sso"))) redirect("/");
  const actor = await getCurrentUser();
  if (!actor) redirect("/");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect(errorPath("validation_error"));

  const result = await revokeScimToken(actor, id);
  if (!result.ok) redirect(errorPath(result.error));

  revalidateScim();
}
