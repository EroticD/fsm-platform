// i18n-ignore-file: revisjonshandlinger er stabile driftsdata.
import { NextResponse } from "next/server";
import { auditRequestContext, auditStandalone } from "@/lib/audit";
import { createSessionCookie, setPendingTwoFactor } from "@/lib/session-token";
import { moduleEnabled } from "@/server/modules";
import {
  SamlConfigError,
  findSamlProvider,
  handleSamlResponse,
  readSamlRelayState,
  samlTwoFactorGate,
} from "@/server/saml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

function failure(request: Request, code = "SsoInvalidClaims") {
  return NextResponse.redirect(
    new URL(`/logg-inn?error=${encodeURIComponent(code)}`, request.url),
  );
}

/**
 * Avviser en SAML-innlogging og skriver en revisjonsrad for avvisningen.
 *
 * SAML-svaret, assertionen og claims lagres aldri – bare leverandørens slug og
 * den stabile årsakskoden. Loggingen er best effort: den kan aldri endre
 * svaret klienten får.
 */
async function reject(
  request: Request,
  reason: string,
  code = "SsoInvalidClaims",
  provider: string | null = null,
) {
  try {
    await auditStandalone({
      entityType: "User",
      entityId: "unknown",
      action: `SSO: SAML-innlogging avvist (${reason})`,
      actionCode: "auth.sso.rejected",
      outcome: "DENIED",
      retentionClass: "SECURITY_1Y",
      actor: { id: "", name: null, email: null },
      metadata: { reason, provider },
      context: await auditRequestContext(),
    });
  } catch {
    // Revisjonsraden er best effort, som for passordinnlogging.
  }
  return failure(request, code);
}

/**
 * AssertionConsumerService. Godtar bare POST fra IdP-en.
 *
 * Signaturen, audience/recipient og tidsvinduet valideres av node-saml før
 * noen bruker slås opp. Replay av samme assertion avvises av den delbare
 * cachen i databasen.
 */
export async function POST(request: Request, context: RouteContext) {
  if (!(await moduleEnabled("sso"))) {
    return reject(request, "module_disabled", "SsoDisabled");
  }

  const { slug } = await context.params;
  const config = findSamlProvider(slug);
  if (!config) return reject(request, "unknown_provider", "SsoConfiguration", slug);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return reject(request, "invalid_form_data", "SsoInvalidClaims", slug);
  }

  const samlResponse = formData.get("SAMLResponse");
  const relayState = formData.get("RelayState");
  if (typeof samlResponse !== "string" || !samlResponse) {
    return reject(request, "missing_response", "SsoInvalidClaims", slug);
  }
  if (!config.allowIdpInitiated && (typeof relayState !== "string" || !relayState)) {
    return reject(request, "missing_relay_state", "SsoInvalidClaims", slug);
  }

  try {
    const result = await handleSamlResponse(config, {
      SAMLResponse: samlResponse,
      ...(typeof relayState === "string" && relayState
        ? { RelayState: relayState }
        : {}),
    });
    if (!result.ok) {
      return reject(
        request,
        result.reason,
        result.reason === "not_provisioned"
          ? "SsoNotProvisioned"
          : "SsoInvalidClaims",
        slug,
      );
    }

    const gate = samlTwoFactorGate(result.user);
    if (gate !== "ok") {
      await setPendingTwoFactor(result.user.id);
      if (gate === "enroll") {
        try {
          await auditStandalone({
            entityType: "User",
            entityId: result.user.id,
            action: "2FA: påkrevd oppsett startet",
            actionCode: "user.2fa.enrollment.required",
            outcome: "SUCCESS",
            retentionClass: "SECURITY_1Y",
            actor: {
              id: result.user.id,
              name: result.user.name,
              email: result.user.email,
            },
            departmentId: result.user.departmentId,
            targetUserId: result.user.id,
            metadata: { reason: "policy", method: "saml", provider: slug },
            context: await auditRequestContext(),
          });
        } catch {
          // Revisjonsraden er best effort, som for passordinnlogging.
        }
        return NextResponse.redirect(
          new URL("/logg-inn/2fa/oppsett", request.url),
        );
      }
      return NextResponse.redirect(new URL("/logg-inn/2fa", request.url));
    }

    await createSessionCookie({
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
      sessionVersion: result.user.sessionVersion,
    });

    const callbackUrl = await readSamlRelayState(
      slug,
      typeof relayState === "string" ? relayState : null,
    );
    return NextResponse.redirect(new URL(callbackUrl, request.url));
  } catch (error) {
    if (!(error instanceof SamlConfigError)) {
      console.error(
        "SAML: ACS feilet",
        error instanceof Error ? error.name : "unknown",
      );
    }
    return reject(request, "server_error", "SsoServerError", slug);
  }
}

export async function GET(request: Request) {
  return reject(request, "wrong_method");
}
