import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listOutbox: vi.fn(),
  removeOutbox: vi.fn(),
  countOutbox: vi.fn(),
  enqueueOutbox: vi.fn(),
  incrementOutboxAttempt: vi.fn(),
  deleteOfflineDraft: vi.fn(),
  getOfflineDraft: vi.fn(),
  putOfflineDraft: vi.fn(),
}));

vi.mock("./db", () => db);

import {
  payloadMatchesReport,
  removeOutboxForReport,
} from "./draft-outbox";

describe("offline outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gjenkjenner en outbox-oppføring for samme oppdrag og mal", () => {
    const payload = JSON.stringify({
      workOrderId: "wo1",
      templateId: "tpl1",
      notes: "Kladd",
    });

    expect(payloadMatchesReport(payload, "wo1", "tpl1")).toBe(true);
    expect(payloadMatchesReport(payload, "wo2", "tpl1")).toBe(false);
    expect(payloadMatchesReport("ikke-json", "wo1", "tpl1")).toBe(false);
  });

  it("fjerner bare oppføringer som hører til den innsendte rapporten", async () => {
    db.listOutbox.mockResolvedValue([
      {
        id: "a",
        payload: JSON.stringify({ workOrderId: "wo1", templateId: "tpl1" }),
        createdAt: 1,
        attempts: 0,
      },
      {
        id: "b",
        payload: JSON.stringify({ workOrderId: "wo1", templateId: "tpl2" }),
        createdAt: 2,
        attempts: 0,
      },
      {
        id: "c",
        payload: "ugyldig",
        createdAt: 3,
        attempts: 0,
      },
    ]);
    db.removeOutbox.mockResolvedValue(undefined);

    await expect(
      removeOutboxForReport({ workOrderId: "wo1", templateId: "tpl1" }),
    ).resolves.toBe(1);
    expect(db.removeOutbox).toHaveBeenCalledTimes(1);
    expect(db.removeOutbox).toHaveBeenCalledWith("a");
  });
});
