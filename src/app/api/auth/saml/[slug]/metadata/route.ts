// i18n-ignore-file: HTTP-feil for metadata-endepunktet er protokolltekst.
import { NextResponse } from "next/server";
import { moduleEnabled } from "@/server/modules";
import {
  createSamlInstance,
  findSamlProvider,
  resolveSamlProvider,
} from "@/server/saml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * SP-metadata. IdP-en bruker denne til å registrere ACS-URL og entity id.
 * Bare konfigurerte, gyldige leverandører svarer.
 */
export async function GET(_request: Request, context: RouteContext) {
  if (!(await moduleEnabled("sso"))) {
    return new NextResponse("SSO er ikke aktivert", { status: 404 });
  }
  const { slug } = await context.params;
  const config = findSamlProvider(slug);
  if (!config) {
    return new NextResponse("Ukjent SAML-leverandør", { status: 404 });
  }

  try {
    const runtime = await resolveSamlProvider(config);
    const saml = createSamlInstance(runtime);
    const metadata = saml.generateServiceProviderMetadata(null, null);
    return new NextResponse(metadata, {
      headers: {
        "Content-Type": "application/samlmetadata+xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("SAML-metadata er ikke tilgjengelig", {
      status: 503,
    });
  }
}
