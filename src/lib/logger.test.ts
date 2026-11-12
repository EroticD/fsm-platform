import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `next/headers` kaster utenfor en request-kontekst. Vi etterligner det med en
 * mock som kan skrus av og på, slik at både request- og skript-stien dekkes.
 */
const mockHeadersState = vi.hoisted(() => ({
  current: null as null | { get(name: string): string | null },
}));

vi.mock("next/headers", () => ({
  headers: async () => {
    if (!mockHeadersState.current) {
      throw new Error("`headers` was called outside a request scope.");
    }
    return mockHeadersState.current;
  },
}));

const { logger, requestIdFrom } = await import("./logger");
const { logServerError } = await import("./log-context");

type LogLine = Record<string, unknown>;

function captureConsole() {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  return { error, warn, log };
}

function parseLines(spy: { mock: { calls: unknown[][] } }): LogLine[] {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])) as LogLine);
}

const originalLogLevel = process.env.LOG_LEVEL;

beforeEach(() => {
  mockHeadersState.current = null;
  process.env.LOG_LEVEL = "info";
});

afterEach(() => {
  vi.restoreAllMocks();
  mockHeadersState.current = null;
  if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalLogLevel;
});

describe("logger", () => {
  it("skriver JSON med tid, nivå, melding og kontekst", () => {
    const spies = captureConsole();

    logger.info("hei", { workOrderId: "wo-1" });

    const [line] = parseLines(spies.log);
    expect(line.level).toBe("info");
    expect(line.message).toBe("hei");
    expect(line.workOrderId).toBe("wo-1");
    expect(typeof line.time).toBe("string");
  });

  it("respekterer LOG_LEVEL", () => {
    const spies = captureConsole();
    process.env.LOG_LEVEL = "error";

    logger.info("skjult");
    logger.debug("også skjult");
    logger.error("synlig");

    expect(spies.log).not.toHaveBeenCalled();
    expect(parseLines(spies.error)).toHaveLength(1);
    expect(parseLines(spies.error)[0].message).toBe("synlig");
  });
});

describe("requestIdFrom", () => {
  it("gjenbruker x-request-id og lager ellers en ny id", () => {
    expect(requestIdFrom(new Headers({ "x-request-id": " req-1 " }))).toBe(
      "req-1",
    );
    const generated = requestIdFrom(new Headers());
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("logServerError", () => {
  it("tar med requestId fra headers() og normaliserer feilen", async () => {
    const spies = captureConsole();
    mockHeadersState.current = {
      get: (name) =>
        name.toLowerCase() === "x-request-id" ? "req-abc" : null,
    };

    const error = new TypeError("noe gikk galt");
    await logServerError("Kunne ikke opprette kunde", error, {
      customerId: "cust-1",
    });

    const [line] = parseLines(spies.error);
    expect(line.level).toBe("error");
    expect(line.message).toBe("Kunne ikke opprette kunde");
    expect(line.requestId).toBe("req-abc");
    expect(line.customerId).toBe("cust-1");
    expect(line.error).toEqual({
      name: "TypeError",
      message: "noe gikk galt",
    });
    // Verken stack eller hele feilobjektet skal med.
    expect(JSON.stringify(line)).not.toContain("stack");
    expect(Object.keys(line.error as object).sort()).toEqual(["message", "name"]);
  });

  it("logger uten requestId når headers() ikke er tilgjengelig, og kaster ikke", async () => {
    const spies = captureConsole();
    mockHeadersState.current = null;

    await expect(
      logServerError("Kunne ikke lagre dokument", new Error("db nede"), {
        documentId: "doc-1",
      }),
    ).resolves.toBeUndefined();

    const [line] = parseLines(spies.error);
    expect(line.message).toBe("Kunne ikke lagre dokument");
    expect("requestId" in line).toBe(false);
    expect(line.documentId).toBe("doc-1");
    expect(line.error).toEqual({ name: "Error", message: "db nede" });
  });

  it("håndterer ikke-Error-verdier og kapper lange meldinger", async () => {
    const spies = captureConsole();
    mockHeadersState.current = { get: () => null };

    await logServerError("Rå feil", "streng-feil");
    await logServerError("Lang feil", new Error("x".repeat(900)));

    const lines = parseLines(spies.error);
    expect(lines[0].error).toEqual({
      name: "UnknownError",
      message: "streng-feil",
    });
    expect("requestId" in lines[0]).toBe(false);
    expect((lines[1].error as { message: string }).message).toHaveLength(500);
  });

  it("respekterer LOG_LEVEL=error", async () => {
    const spies = captureConsole();
    process.env.LOG_LEVEL = "error";
    mockHeadersState.current = { get: () => "req-1" };

    await logServerError("Feil", new Error("boom"));

    expect(parseLines(spies.error)).toHaveLength(1);
  });
});
