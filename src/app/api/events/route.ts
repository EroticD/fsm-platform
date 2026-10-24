import { Client } from "pg";
import { isRealtimeKind, REALTIME_CHANNEL } from "@/lib/realtime";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hyppig nok til at proxyer og nettlesere holder forbindelsen åpen. */
const HEARTBEAT_MS = 25_000;

/**
 * node-postgres kjenner ikke Prismas `?schema=`-parameter. Den må fjernes før
 * tilkoblingsstrengen brukes, ellers tolkes den som en ukjent parameter.
 */
function realtimeConnectionString(): string {
  const raw = process.env.DATABASE_URL ?? "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.searchParams.delete("schema");
    return url.toString();
  } catch {
    return raw;
  }
}

/**
 * Server-sendte hendelser for dataendringer. Hver tilkobling lytter på
 * PostgreSQL-kanalen og videresender bare kategori-navnet – aldri data.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const connectionString = realtimeConnectionString();
  if (!connectionString) {
    return new Response("Realtime er ikke konfigurert", { status: 503 });
  }

  const encoder = new TextEncoder();
  let client: Client | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (message: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(message));
        } catch {
          closed = true;
        }
      };

      const stop = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        const current = client;
        client = null;
        if (current) {
          void current.end().catch(() => {});
        }
        try {
          controller.close();
        } catch {
          // Strømmen kan allerede være lukket av nettleseren.
        }
      };

      request.signal.addEventListener("abort", stop, { once: true });

      // Nettleseren prøver igjen etter fem sekunder hvis forbindelsen ryker.
      send("retry: 5000\n\n");

      client = new Client({ connectionString });
      const pgClient = client;
      pgClient.on("notification", (message) => {
        if (message.channel !== REALTIME_CHANNEL) return;
        const kind = message.payload?.trim();
        if (!kind || !isRealtimeKind(kind)) return;
        send(`event: refresh\ndata: ${kind}\n\n`);
      });
      pgClient.on("error", stop);
      pgClient.on("end", stop);

      try {
        await pgClient.connect();
        if (closed) {
          void pgClient.end().catch(() => {});
          return;
        }
        await pgClient.query(`LISTEN ${REALTIME_CHANNEL}`);
      } catch {
        stop();
        return;
      }

      heartbeat = setInterval(() => send(": heartbeat\n\n"), HEARTBEAT_MS);
      heartbeat.unref?.();
    },

    cancel() {
      // Nettleseren lukket strømmen. Rydd opp uten å røre controlleren.
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      const current = client;
      client = null;
      if (current) void current.end().catch(() => {});
      closed = true;
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
