import { getCurrentUser, isStaff } from "@/lib/session";
import { clientIpFrom } from "@/lib/client-ip";
import {
  acquireRealtimeSlot,
  releaseRealtimeSlot,
  subscribeRealtime,
} from "@/lib/realtime-hub";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hyppig nok til at proxyer og nettlesere holder forbindelsen åpen. */
const HEARTBEAT_MS = 25_000;

/**
 * Server-sendte hendelser for dataendringer.
 *
 * Alle tilkoblinger deler én `LISTEN`-forbindelse per prosess (se
 * `realtime-hub.ts`). Ruten krever en aktiv, intern bruker: kundeportalen og
 * utloggede får ingen strøm, og det er en hard grense per bruker/IP.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isStaff(user.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const slot = {
    userId: user.id,
    ip: clientIpFrom(request.headers),
  };
  if (!acquireRealtimeSlot(slot)) {
    logger.warn("Realtime: connection limit reached", {
      userId: user.id,
      ip: slot.ip ?? null,
    });
    return new Response("Too many realtime connections", {
      status: 429,
      headers: { "Retry-After": "30" },
    });
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;
  let released = false;
  let closed = false;

  const cleanup = (controller?: ReadableStreamDefaultController<Uint8Array>) => {
    if (closed) {
      if (controller) {
        try {
          controller.close();
        } catch {
          // Allerede lukket.
        }
      }
      return;
    }
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    unsubscribe?.();
    unsubscribe = null;
    if (!released) {
      released = true;
      releaseRealtimeSlot(slot);
    }
    if (controller) {
      try {
        controller.close();
      } catch {
        // Nettleseren lukket strømmen først.
      }
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (message: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(message));
        } catch {
          cleanup(controller);
        }
      };

      request.signal.addEventListener("abort", () => cleanup(controller), {
        once: true,
      });

      // Nettleserens innebygde retry brukes bare som fallback; klienten har
      // egen, begrenset backoff (se RealtimeRefresh).
      send("retry: 5000\n\n");

      unsubscribe = subscribeRealtime((kind) => {
        send(`event: refresh\ndata: ${kind}\n\n`);
      });

      heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_MS);
      heartbeat.unref?.();
    },

    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
