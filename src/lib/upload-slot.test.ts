import { describe, expect, it } from "vitest";
import {
  MAX_CONCURRENT_UPLOADS,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_REQUEST_BYTES,
  maxBytesForMime,
  withUploadSlot,
} from "./upload-slot";

describe("opplastingsgrenser", () => {
  it("bruker en lavere grense for bilder enn for PDF", () => {
    expect(MAX_IMAGE_BYTES).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
    expect(maxBytesForMime("application/pdf")).toBe(MAX_DOCUMENT_BYTES);
    expect(maxBytesForMime("image/jpeg")).toBe(MAX_IMAGE_BYTES);
    expect(MAX_REQUEST_BYTES).toBeGreaterThan(MAX_DOCUMENT_BYTES);
  });
});

describe("withUploadSlot", () => {
  it("kjører aldri flere samtidig enn grensen", async () => {
    let active = 0;
    let maxActive = 0;

    const task = () =>
      withUploadSlot(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      });

    await Promise.all(
      Array.from({ length: MAX_CONCURRENT_UPLOADS + 3 }, () => task()),
    );

    expect(maxActive).toBe(MAX_CONCURRENT_UPLOADS);
    expect(active).toBe(0);
  });

  it("frigir plassen når jobben feiler", async () => {
    await expect(
      withUploadSlot(async () => {
        throw new Error("feil");
      }),
    ).rejects.toThrow("feil");

    let ran = false;
    await withUploadSlot(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
