// i18n-ignore-file: SCIM ServiceProviderConfig er protokollmetadata.
import { authenticateScimRequest } from "@/server/scim-tokens";
import { scimJsonResponse } from "@/lib/scim-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SCIM ServiceProviderConfig. IdP-er leser denne før de slår på provisjonering.
 * Endepunktet krever samme bearer-token som resten av SCIM-flaten, slik at
 * kapabilitetene ikke er offentlig kartlagt.
 */
export async function GET(request: Request) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return auth.response;

  return scimJsonResponse({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: "https://www.rfc-editor.org/rfc/rfc7644",
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "SCIM-token opprettet av administrator i Innstillinger.",
        specUri: "https://www.rfc-editor.org/rfc/rfc6750",
        primary: true,
      },
    ],
  });
}
