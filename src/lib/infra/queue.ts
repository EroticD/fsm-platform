// i18n-ignore-file: køens nøkler og logger er driftsdata.
import type { Redis } from "ioredis";
import { logger } from "@/lib/logger";
import { getRedisClient, queueDriver } from "./redis";

/**
 * Redis brukes som rask varslingskanal foran den vedvarende `DocumentJob`-køen.
 *
 * Databasen er alltid kilden til sannhet: en jobb finnes som rad, og selve
 * tilstandsovergangen er en betinget SQL-oppdatering. Redis holder bare en
 * sortert liste over jobb-ID-er som er klare til å kjøres. Da kan flere
 * replikaer vekkes umiddelbart uten polling, mens Redis-utfall faller tilbake
 * til `FOR UPDATE SKIP LOCKED` uten å miste jobber.
 */
export const PDF_TEXT_QUEUE_KEY = "fsm:queue:pdf-text";

export type PdfQueueBackend = "db" | "redis";

export function pdfQueueBackend(
  env: Record<string, string | undefined> = process.env,
): PdfQueueBackend {
  return queueDriver(env) === "redis" ? "redis" : "db";
}

type RedisQueueClient = Pick<Redis, "zadd" | "zrangebyscore" | "zrem" | "zcard">;

async function client(): Promise<RedisQueueClient | null> {
  return (await getRedisClient()) as RedisQueueClient | null;
}

/** Legger jobben i Redis-listen. No-op når Redis ikke er aktiv. */
export async function notifyPdfJob(
  jobId: string,
  runAt: Date = new Date(),
): Promise<boolean> {
  const redis = await client();
  if (!redis) return false;
  try {
    // ZADD oppdaterer score for et medlem som allerede finnes. Det gir
    // idempotent varsling: samme jobb kan varsles etter hvert retry uten å
    // dupliseres, fordi medlemmet er jobb-ID-en.
    await redis.zadd(PDF_TEXT_QUEUE_KEY, runAt.getTime(), jobId);
    return true;
  } catch (error) {
    logger.warn("Kunne ikke varsle Redis om PDF-jobb", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Henter jobb-ID-er som er klare. Redis-listen er «at-least-once»: en krasjet
 * prosess kan ha tatt en ID før den rakk å oppdatere databasen. Det er trygt,
 * fordi databasen bare lar én prosess vinne den betingede overgangen.
 */
export async function takeDuePdfJobIds(
  now: Date = new Date(),
  limit = 20,
): Promise<string[]> {
  const redis = await client();
  if (!redis) return [];
  try {
    const ids = await redis.zrangebyscore(
      PDF_TEXT_QUEUE_KEY,
      "-inf",
      now.getTime(),
      "LIMIT",
      0,
      Math.max(1, limit),
    );
    if (ids.length > 0) {
      await redis.zrem(PDF_TEXT_QUEUE_KEY, ...ids);
    }
    return ids;
  } catch (error) {
    logger.warn("Kunne ikke lese Redis-køen for PDF-jobber", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** Fjerner en jobb fra Redis-listen etter DONE/FAILED. */
export async function forgetPdfJob(jobId: string): Promise<void> {
  const redis = await client();
  if (!redis) return;
  await redis.zrem(PDF_TEXT_QUEUE_KEY, jobId).catch(() => undefined);
}

export async function pdfQueueSize(): Promise<number> {
  const redis = await client();
  if (!redis) return 0;
  try {
    return await redis.zcard(PDF_TEXT_QUEUE_KEY);
  } catch {
    return 0;
  }
}
