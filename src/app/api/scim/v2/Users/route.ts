import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { parseScimPagination, scimListResponse } from "@/lib/scim";
import {
  scimBaseUrl,
  scimBadRequest,
  scimFailureResponse,
  scimJsonResponse,
  scimPayloadTooLarge,
} from "@/lib/scim-http";
import {
  authenticateScimRequest,
  scimActorFromToken,
} from "@/server/scim-tokens";
import { createScimUser, listScimUsers } from "@/server/scim-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SCIM 2.0 – brukere.
 *
 * `GET` støtter `filter`, `startIndex` og `count`. `POST` oppretter en bruker
 * med laveste rolle med mindre en eksplisitt mapping sier noe annet. Passord
 * settes aldri.
 */
export async function GET(request: Request) {
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const pagination = parseScimPagination(url);
  const result = await listScimUsers(
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
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return auth.response;

  const body = await readJsonWithLimit(request, JSON_BODY_LIMIT);
  if (!body.ok) {
    return body.status === 413
      ? scimPayloadTooLarge()
      : scimBadRequest("Ugyldig JSON.", "invalidSyntax");
  }

  const result = await createScimUser(
    body.data,
    scimActorFromToken(auth.token),
  );
  if (!result.ok) return scimFailureResponse(result);

  const id = typeof result.data.id === "string" ? result.data.id : "";
  return scimJsonResponse(result.data, 201, {
    Location: `${scimBaseUrl(request)}/api/scim/v2/Users/${id}`,
  });
}
