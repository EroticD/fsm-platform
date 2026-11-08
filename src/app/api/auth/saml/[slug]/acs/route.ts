// i18n-ignore-file: revisjonshandlinger er stabile driftsdata.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
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
 * AssertionConsumerService. Godtar bare POST fra IdP-en.
 *
 * Signaturen, audience/recipient og tidsvinduet valideres av node-saml før
 * noen bruker slås opp. Replay av samme assertion avvises av den delbare
 * cachen i databasen.
 */
export async function POST(request: Request, context: RouteContext) {
  if (!(await moduleEnabled("sso"))) return failure(request, "SsoDisabled");

  const { slug } = await context.params;
  const config = findSamlProvider(slug);
  if (!config) return failure(request, "SsoConfiguration");

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return failure(request);
  }

  const samlResponse = formData.get("SAMLResponse");
  const relayState = formData.get("RelayState");
  if (typeof samlResponse !== "string" || !samlResponse) {
    return failure(request);
  }
  if (!config.allowIdpInitiated && (typeof relayState !== "string" || !relayState)) {
    return failure(request);
  }

  try {
    const result = await handleSamlResponse(config, {
      SAMLResponse: samlResponse,
      ...(typeof relayState === "string" && relayState
        ? { RelayState: relayState }
        : {}),
    });
    if (!result.ok) {
      return failure(
        request,
        result.reason === "not_provisioned"
          ? "SsoNotProvisioned"
          : "SsoInvalidClaims",
      );
    }

    const gate = samlTwoFactorGate(result.user);
    if (gate !== "ok") {
      await setPendingTwoFactor(result.user.id);
      if (gate === "enroll") {
        try {
          await prisma.auditLog.create({
            data: {
              entityType: "User",
              entityId: result.user.id,
              action: "2FA: påkrevd oppsett startet",
              userName: result.user.name || result.user.email || "Ukjent",
              actorId: result.user.id,
            },
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
    return failure(request, "SsoServerError");
  }
}

export function GET(request: Request) {
  return failure(request);
}
