import { NextResponse } from "next/server";
import {
  API_RESPONSE_HEADERS,
  apiError,
  type ApiErrorBody,
  type ApiErrorCode,
} from "@/lib/api-errors";

export { API_RESPONSE_HEADERS, apiError };
export type { ApiErrorBody, ApiErrorCode };

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
