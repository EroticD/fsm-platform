import { describe, expect, it } from "vitest";
import {
  getRenderQueueState,
  MAX_CONCURRENT_RENDERS,
  withRenderSlot,
} from "./render-queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** La alle ventende mikrotasks få kjøre. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("withRenderSlot", () => {
  it("rendrer aldri mer enn to PDF-er samtidig", async () => {
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());

    const tasks = gates.map((gate) =>
      withRenderSlot(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
      }),
    );

    await tick();

    expect(MAX_CONCURRENT_RENDERS).toBe(2);
    expect(peak).toBe(2);
    expect(getRenderQueueState()).toMatchObject({ active: 2, waiting: 3 });

    // Når én blir ferdig, slipper neste inn – fortsatt bare to aktive.
    gates[0].resolve();
    await tick();
    expect(getRenderQueueState()).toMatchObject({ active: 2, waiting: 2 });

    for (const gate of gates) gate.resolve();
    await Promise.all(tasks);

    expect(peak).toBe(2);
    expect(getRenderQueueState()).toMatchObject({ active: 0, waiting: 0 });
  });

  it("frigir plassen også når rendringen feiler", async () => {
    const failure = withRenderSlot(async () => {
      throw new Error("render feilet");
    });

    await expect(failure).rejects.toThrow("render feilet");
    expect(getRenderQueueState().active).toBe(0);

    // Neste jobb skal få plass umiddelbart.
    await expect(withRenderSlot(async () => "ok")).resolves.toBe("ok");
  });
});
