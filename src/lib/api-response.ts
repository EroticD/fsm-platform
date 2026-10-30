import { NextResponse } from "next/server";

/**
 * Felles svarkonvolutter for REST-API-et.
 *
 * API-et er bearer-basert, så svarene skal aldri mellomlagres delt. `Vary`
 * gjør også at en eventuell cache foran appen skiller på Authorization.
 */
export const API_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
} as const;

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "conflict"
  | "rate_limited"
  | "server_error";

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
};

export type ApiSuccessBody<T> = {
  data: T;
  meta?: unknown;
};

function jsonResponse(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: API_RESPONSE_HEADERS,
  });
}

/**
 * Vellykket JSON-svar på formen `{ data, meta? }`.
 *
 * Andre argument kan være metadata, eller et statusnummer når kallet ikke har
 * metadata (`apiJson(data, 201)`).
 */
export function apiJson<T>(
  data: T,
  metaOrStatus?: unknown,
  status = 200,
): NextResponse {
  const hasMeta = typeof metaOrStatus !== "number";
  const responseStatus =
    typeof metaOrStatus === "number" ? metaOrStatus : status;
  const body: ApiSuccessBody<T> = hasMeta && metaOrStatus !== undefined
    ? { data, meta: metaOrStatus }
    : { data };
  return jsonResponse(body, responseStatus);
}

/** Feilsvar med stabil maskinlesbar kode og valgfri detaljinformasjon. */
export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): NextResponse {
  const body: ApiErrorBody = {
    error: details === undefined ? { code, message } : { code, message, details },
  };
  return jsonResponse(body, status);
}
