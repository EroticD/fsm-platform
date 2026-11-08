import type { NextRequest } from "next/server";
import { readRequestBodyWithLimit } from "@/lib/upload-validation";
import { TRANSFER_LIMITS } from "@/lib/customer-transfer/constants";
import {
  guardTransferRoute,
  requireSameOrigin,
  transferFailureResponse,
  transferJson,
  transferRateLimit,
} from "@/lib/customer-transfer/http";
import { createImportJob } from "@/server/customer-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readPackageFromRequest(
  request: NextRequest,
): Promise<{ buffer: Buffer; fileName: string; passphrase?: string } | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return null;
    if (file.size > TRANSFER_LIMITS.maxPackageBytes) return null;
    const passphraseValue = form?.get("passphrase");
    return {
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name || "package.zip",
      ...(typeof passphraseValue === "string" && passphraseValue
        ? { passphrase: passphraseValue }
        : {}),
    };
  }

  const limited = await readRequestBodyWithLimit(
    request,
    TRANSFER_LIMITS.maxPackageBytes,
  );
  if (!limited.ok) return null;
  const fileName =
    request.nextUrl.searchParams.get("filename")?.slice(0, 200) ?? "package.zip";
  // Passfrasen skal helst sendes i multipart-feltet. Headeren finnes for
  // CLI-bruk, men må ikke logges av proxyer; se docs/OPERATIONS.md.
  const passphrase = request.headers.get("x-transfer-passphrase") ?? undefined;
  return { buffer: limited.buffer, fileName, ...(passphrase ? { passphrase } : {}) };
}

export async function POST(request: NextRequest) {
  const guard = await guardTransferRoute();
  if (!guard.ok) return guard.response;
  const origin = requireSameOrigin(request);
  if (origin) return origin;

  const limited = await transferRateLimit(
    `customer-transfer-import:${guard.actor.id}`,
    3,
    60 * 60 * 1000,
  );
  if (limited) return limited;

  let payload: { buffer: Buffer; fileName: string; passphrase?: string } | null;
  try {
    payload = await readPackageFromRequest(request);
  } catch {
    payload = null;
  }
  if (!payload) {
    return transferJson(
      {
        error: "customer_transfer.invalid_manifest",
        messageKey: "errors.customerTransfer.invalidManifest",
      },
      { status: 413 },
    );
  }

  const result = await createImportJob(
    guard.actor,
    payload.buffer,
    payload.fileName,
    { passphrase: payload.passphrase ?? null },
  );
  if (!result.ok) return transferFailureResponse(result);
  return transferJson(result.data, { status: 202 });
}
