// i18n-ignore-file: SCIM-feil og loggertekst er protokoll-/driftsdata.
import { NextResponse } from "next/server";
import {
  SCIM_CONTENT_TYPE,
  scimErrorBody,
} from "@/lib/scim";

/**
 * Felles HTTP-hjelpere for SCIM. Alle svar, også feil, bruker
 * `application/scim+json` og SCIM-feilskjemaet.
 */
export function scimJsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Content-Type": SCIM_CONTENT_TYPE,
      "Cache-Control": "private, no-store",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function scimNoContentResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function scimFailureResponse(failure: {
  status: number;
  detail: string;
  scimType?: string;
}): NextResponse {
  return scimJsonResponse(
    scimErrorBody(failure.status, failure.detail, failure.scimType),
    failure.status,
  );
}

export function scimBadRequest(detail: string, scimType = "invalidSyntax"): NextResponse {
  return scimJsonResponse(scimErrorBody(400, detail, scimType), 400);
}

export function scimPayloadTooLarge(): NextResponse {
  return scimJsonResponse(
    scimErrorBody(413, "Forespørselen er for stor.", "tooLarge"),
    413,
  );
}

/** Absolutt base-URL til `meta.location` og Location-headeren. */
export function scimBaseUrl(request: Request): string {
  return new URL(request.url).origin;
}
