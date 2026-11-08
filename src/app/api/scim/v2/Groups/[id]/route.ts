import { JSON_BODY_LIMIT, readJsonWithLimit } from "@/lib/request-body";
import { moduleApiGuard } from "@/lib/module-guards";
import {
  scimBadRequest,
  scimBaseUrl,
  scimFailureResponse,
  scimJsonResponse,
  scimNoContentResponse,
  scimPayloadTooLarge,
} from "@/lib/scim-http";
import {
  authenticateScimRequest,
  scimActorFromToken,
} from "@/server/scim-tokens";
import {
  deleteScimGroup,
  getScimGroup,
  patchScimGroup,
  updateScimGroup,
} from "@/server/scim-groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function readBody(request: Request) {
  const body = await readJsonWithLimit(request, JSON_BODY_LIMIT);
  if (!body.ok) {
    return body.status === 413
      ? { ok: false as const, response: scimPayloadTooLarge() }
      : {
          ok: false as const,
          response: scimBadRequest("Ugyldig JSON.", "invalidSyntax"),
        };
  }
  return body;
}

export async function GET(request: Request, context: RouteContext) {
  const moduleGuard = await moduleApiGuard("sso");
  if (moduleGuard) return moduleGuard;
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const result = await getScimGroup(id, scimBaseUrl(request));
  if (!result.ok) return scimFailureResponse(result);
  return scimJsonResponse(result.data);
}

export async function PUT(request: Request, context: RouteContext) {
  const moduleGuard = await moduleApiGuard("sso");
  if (moduleGuard) return moduleGuard;
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return auth.response;

  const body = await readBody(request);
  if (!body.ok) return body.response;

  const { id } = await context.params;
  const result = await updateScimGroup(
    id,
    body.data,
    scimActorFromToken(auth.token),
  );
  if (!result.ok) return scimFailureResponse(result);
  return scimJsonResponse(result.data);
}

export async function PATCH(request: Request, context: RouteContext) {
  const moduleGuard = await moduleApiGuard("sso");
  if (moduleGuard) return moduleGuard;
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return auth.response;

  const body = await readBody(request);
  if (!body.ok) return body.response;

  const { id } = await context.params;
  const result = await patchScimGroup(
    id,
    body.data,
    scimActorFromToken(auth.token),
  );
  if (!result.ok) return scimFailureResponse(result);
  return scimJsonResponse(result.data);
}

export async function DELETE(request: Request, context: RouteContext) {
  const moduleGuard = await moduleApiGuard("sso");
  if (moduleGuard) return moduleGuard;
  const auth = await authenticateScimRequest(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const result = await deleteScimGroup(
    id,
    scimActorFromToken(auth.token),
  );
  if (!result.ok) return scimFailureResponse(result);
  return scimNoContentResponse();
}
