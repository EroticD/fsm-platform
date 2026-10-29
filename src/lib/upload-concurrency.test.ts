import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_CONCURRENT_UPLOAD_BODY_READS,
  getUploadBodyGateState,
  tryAcquireUploadBodySlot,
  type UploadBodyLease,
} from "./upload-concurrency";

const held: UploadBodyLease[] = [];

function acquire() {
  const lease = tryAcquireUploadBodySlot();
  if (lease) held.push(lease);
  return lease;
}

afterEach(() => {
  for (const lease of held.splice(0)) lease.release();
});

describe("upload body gate", () => {
  it("slipper aldri flere samtidige lesinger enn grensen", () => {
    for (let index = 0; index < MAX_CONCURRENT_UPLOAD_BODY_READS; index += 1) {
      expect(acquire()).not.toBeNull();
    }

    expect(tryAcquireUploadBodySlot()).toBeNull();
    expect(getUploadBodyGateState()).toEqual({
      active: MAX_CONCURRENT_UPLOAD_BODY_READS,
      max: MAX_CONCURRENT_UPLOAD_BODY_READS,
    });
  });

  it("frigir plassen slik at en ny lesing kan starte", () => {
    const first = acquire();
    expect(first).not.toBeNull();

    first?.release();
    expect(getUploadBodyGateState().active).toBe(0);

    const second = acquire();
    expect(second).not.toBeNull();
    expect(getUploadBodyGateState().active).toBe(1);
  });

  it("teller bare én frigivelse per lån", () => {
    const lease = acquire();
    expect(lease).not.toBeNull();

    lease?.release();
    lease?.release();
    lease?.release();

    expect(getUploadBodyGateState().active).toBe(0);
  });
});
