import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { parseScimPagination, scimListResponse } from "@/lib/scim";
import {
  scimBaseUrl,
  scimBadRequest,
  scimFailureResponse,
  scimJsonResponse,
  scimPayloadTooLarge,
} from "@/lib/scim-http";
import { moduleApiGuard } from "@/lib/module-guards";
import {
  authenticateScimRequest,
  scimActorFromToken,
} from "@/server/scim-tokens";
import { createScimGroup, listScimGroups } from "@/server/scim-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SCIM 2.0 – grupper.
 *
 * `filter` støtter displayName, externalId, id og members. Paginering og
 * feilformat følger RFC 7644. Medlemskap gir bare tilgang gjennom eksplisitt
 * mapping; ADMIN krever SCIM_ALLOW_ADMIN=true.
 */
export async function GET(request: Request) {
  const moduleGuard = await moduleApiGuard("sso");
  if (moduleGuard) return moduleGuard;
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const pagination = parseScimPagination(url);
  const result = await listScimGroups(
    {
      filter: url.searchParams.get("filter"),
      startIndex: pagination.startIndex,
      count: pagination.count,
    },
    scimBaseUrl(request),
  );
  if (!result.ok) return scimFailureResponse(result);

  return scimJsonResponse(
    scimListResponse(
      result.data.resources,
      result.data.totalResults,
      pagination.startIndex,
    ),
  );
}

export async function POST(request: Request) {
  const moduleGuard = await moduleApiGuard("sso");
  if (moduleGuard) return moduleGuard;
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return auth.response;

  const body = await readJsonWithLimit(request, JSON_BODY_LIMIT);
  if (!body.ok) {
    return body.status === 413
      ? scimPayloadTooLarge()
      : scimBadRequest("Ugyldig JSON.", "invalidSyntax");
  }

  const result = await createScimGroup(
    body.data,
    scimActorFromToken(auth.token),
  );
  if (!result.ok) return scimFailureResponse(result);

  const id = typeof result.data.id === "string" ? result.data.id : "";
  return scimJsonResponse(result.data, 201, {
    Location: `${scimBaseUrl(request)}/api/scim/v2/Groups/${id}`,
  });
}
