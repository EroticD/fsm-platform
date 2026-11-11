import { NextResponse } from "next/server";
import { safeLoginCallbackTarget } from "@/lib/safe-redirect";
import { moduleEnabled } from "@/server/modules";
import {
  SamlConfigError,
  createSamlInstance,
  createSamlRelayState,
  findSamlProvider,
  resolveSamlProvider,
} from "@/server/saml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * Starter en SAML-innlogging. AuthnRequest-id-en lagres i databasen av
 * node-saml, og RelayState bindes til en signert cookie med callback-URL.
 */
export async function GET(request: Request, context: RouteContext) {
  if (!(await moduleEnabled("sso"))) {
    return NextResponse.redirect(new URL("/logg-inn?error=SsoDisabled", request.url));
  }

  const { slug } = await context.params;
  const config = findSamlProvider(slug);
  if (!config) {
    return NextResponse.redirect(
      new URL("/logg-inn?error=SsoConfiguration", request.url),
    );
  }

  const url = new URL(request.url);
  const callbackUrl = safeLoginCallbackTarget(
    url.searchParams.get("callbackUrl") ?? "/",
  );

  try {
    const runtime = await resolveSamlProvider(config);
    const saml = createSamlInstance(runtime);
    const relayState = await createSamlRelayState(slug, callbackUrl);
    const authorizeUrl = await saml.getAuthorizeUrlAsync(relayState, {});
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    // Feilen logges ikke med sertifikat eller metadata-innhold.
    if (!(error instanceof SamlConfigError)) {
      console.error("SAML: kunne ikke starte innlogging", error instanceof Error ? error.name : "unknown");
    }
    return NextResponse.redirect(
      new URL("/logg-inn?error=SsoConfiguration", request.url),
    );
  }
}
