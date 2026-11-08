import {
  apnsConfig,
  fcmConfig,
  pushProviderStatus,
  type ApnsConfig,
  type FcmConfig,
  type PushProviderStatus,
} from "./config";
import { createApnsProvider } from "./apns";
import { createFcmProvider } from "./fcm";
import type { PushPlatform, PushProvider } from "./types";

export {
  apnsConfig,
  fcmConfig,
  pushProviderStatus,
  type ApnsConfig,
  type FcmConfig,
  type PushProviderStatus,
};
export { resetApnsJwtCacheForTests } from "./apns";
export { resetFcmTokenCacheForTests } from "./fcm";
export { buildApnsJwt, buildApnsPayload, apnsHost } from "./apns";
export { buildFcmAssertion, buildFcmMessage } from "./fcm";
export {
  isPushPlatform,
  PUSH_PLATFORMS,
  type PushDeliveryResult,
  type PushErrorCode,
  type PushPlatform,
  type PushProvider,
  type PushSendInput,
} from "./types";

type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Velger adapter ut fra enhetens plattform. Uten gyldig oppsett returnerer
 * adapteret «not_configured» og gjør ingen nettverkskall.
 */
export function pushProviderForPlatform(
  platform: PushPlatform,
  environment: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
): PushProvider {
  if (platform === "android") {
    return createFcmProvider(fcmConfig(environment), fetchImpl);
  }
  return createApnsProvider(apnsConfig(environment), fetchImpl);
}
