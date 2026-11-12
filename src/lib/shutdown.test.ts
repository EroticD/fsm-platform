import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  installShutdownHandlers,
  onShutdown,
  resetShutdownForTests,
  runShutdown,
  shutdownTimeoutMs,
  uninstallShutdownHandlers,
} from "@/lib/shutdown";

/** Lar den asynkrone signalhåndteringen kjøre ferdig uten å vente på timere. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function stubExit() {
  const codes: number[] = [];
  const spy = vi.spyOn(process, "exit").mockImplementation(((
    code?: string | number | null,
  ) => {
    codes.push(Number(code ?? 0));
    // Ekte process.exit returnerer aldri; testen skal fortsette.
    return undefined as never;
  }) as typeof process.exit);
  return { codes, spy };
}

describe("shutdown", () => {
  const originalTimeout = process.env.SHUTDOWN_TIMEOUT_MS;

  beforeEach(() => {
    resetShutdownForTests();
    delete process.env.SHUTDOWN_TIMEOUT_MS;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    resetShutdownForTests();
    vi.restoreAllMocks();
    if (originalTimeout === undefined) delete process.env.SHUTDOWN_TIMEOUT_MS;
    else process.env.SHUTDOWN_TIMEOUT_MS = originalTimeout;
  });

  it("kjører oppgavene sekvensielt i prioritet og registreringsrekkefølge", async () => {
    const calls: string[] = [];
    // Prisma registreres typisk først (importert tidlig), men skal kjøre sist.
    onShutdown(
      async () => {
        calls.push("prisma:start");
        await new Promise((resolve) => setTimeout(resolve, 5));
        calls.push("prisma:end");
      },
      { name: "prisma", priority: 100 },
    );
    onShutdown(() => {
      calls.push("scheduler");
    }, { name: "scheduler" });
    onShutdown(async () => {
      calls.push("job-worker");
    }, { name: "job-worker" });

    await expect(runShutdown("test")).resolves.toBe(0);
    expect(calls).toEqual([
      "scheduler",
      "job-worker",
      "prisma:start",
      "prisma:end",
    ]);
  });

  it("er idempotent: et nytt signal starter ikke en ny runde", async () => {
    let runs = 0;
    onShutdown(() => {
      runs += 1;
    });

    const first = await runShutdown("SIGTERM");
    const second = await runShutdown("SIGINT");

    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(runs).toBe(1);
  });

  it("kjører ikke oppryddingen to ganger ved to signaler", async () => {
    const { codes } = stubExit();
    let runs = 0;
    onShutdown(() => {
      runs += 1;
    });
    installShutdownHandlers();

    (process.emit as (event: string) => boolean)("SIGTERM");
    (process.emit as (event: string) => boolean)("SIGINT");
    await flush();

    expect(runs).toBe(1);
    expect(codes).toEqual([0]);
  });

  it("fortsetter med neste oppgave når én feiler, og avslutter med kode 1", async () => {
    const calls: string[] = [];
    onShutdown(() => {
      calls.push("first");
      throw new Error("boom");
    });
    onShutdown(() => {
      calls.push("second");
    });

    await expect(runShutdown("test")).resolves.toBe(1);
    expect(calls).toEqual(["first", "second"]);
  });

  it("gir opp etter SHUTDOWN_TIMEOUT_MS, hopper over resten og returnerer 1", async () => {
    process.env.SHUTDOWN_TIMEOUT_MS = "30";
    expect(shutdownTimeoutMs()).toBe(30);

    let laterRan = false;
    onShutdown(() => new Promise<void>(() => {}), { name: "henger" });
    onShutdown(() => {
      laterRan = true;
    }, { name: "etterpå" });

    await expect(runShutdown("test")).resolves.toBe(1);
    expect(laterRan).toBe(false);
  });

  it("bruker standard tidsgrense når SHUTDOWN_TIMEOUT_MS mangler", () => {
    expect(shutdownTimeoutMs()).toBe(DEFAULT_SHUTDOWN_TIMEOUT_MS);
  });

  it("avregistrerer en oppgave med returfunksjonen fra onShutdown", async () => {
    const calls: string[] = [];
    const unregister = onShutdown(() => {
      calls.push("avmeldt");
    });
    onShutdown(() => {
      calls.push("beholdt");
    });

    unregister();
    await runShutdown("test");

    expect(calls).toEqual(["beholdt"]);
  });

  it("installerer lyttere kun én gang, og bare når funksjonen kalles", () => {
    const before = process.listenerCount("SIGTERM");
    const beforeInt = process.listenerCount("SIGINT");

    installShutdownHandlers();
    installShutdownHandlers();

    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    expect(process.listenerCount("SIGINT")).toBe(beforeInt + 1);

    uninstallShutdownHandlers();
    expect(process.listenerCount("SIGTERM")).toBe(before);
    expect(process.listenerCount("SIGINT")).toBe(beforeInt);
  });

  it("avslutter med kode 1 når en oppgave feiler under signalhåndtering", async () => {
    const { codes } = stubExit();
    onShutdown(() => {
      throw new Error("boom");
    });
    installShutdownHandlers();

    (process.emit as (event: string) => boolean)("SIGTERM");
    await flush();

    expect(codes).toEqual([1]);
  });
});
