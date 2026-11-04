import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { upload: { aggregate: mocks.aggregate } },
}));

import {
  checkUploadQuota,
  customerQuotaBytes,
  userQuotaBytes,
} from "./upload-quota";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aggregate.mockResolvedValue({ _sum: { size: 0 } });
});

afterEach(() => {
  delete process.env.UPLOAD_QUOTA_USER_MB;
  delete process.env.UPLOAD_QUOTA_CUSTOMER_MB;
});

describe("checkUploadQuota", () => {
  it("bruker 2 GiB og 10 GiB når miljøvariablene mangler", () => {
    expect(userQuotaBytes()).toBe(2 * 1024 * 1024 * 1024);
    expect(customerQuotaBytes()).toBe(10 * 1024 * 1024 * 1024);
  });

  it("tillater en vanlig opplasting på noen megabyte med standardkvotene", async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { size: 0 } });

    await expect(
      checkUploadQuota({
        userId: "u1",
        customerId: "c1",
        size: 5 * 1024 * 1024,
      }),
    ).resolves.toEqual({ allowed: true });
  });

  it("tillater opplasting innenfor begge kvotene", async () => {
    await expect(
      checkUploadQuota({ userId: "u1", customerId: "c1", size: 1024 }),
    ).resolves.toEqual({ allowed: true });
    expect(mocks.aggregate).toHaveBeenCalledTimes(2);
  });

  it("avviser når brukerens 24-timerskvote overskrides", async () => {
    process.env.UPLOAD_QUOTA_USER_MB = "1";
    mocks.aggregate.mockResolvedValueOnce({ _sum: { size: userQuotaBytes() } });

    const result = await checkUploadQuota({
      userId: "u1",
      customerId: null,
      size: 1,
    });

    expect(result).toMatchObject({
      allowed: false,
      scope: "user",
      limitBytes: userQuotaBytes(),
    });
  });

  it("avviser når kundens samlede kvote overskrides", async () => {
    process.env.UPLOAD_QUOTA_CUSTOMER_MB = "1";
    mocks.aggregate
      .mockResolvedValueOnce({ _sum: { size: 0 } })
      .mockResolvedValueOnce({ _sum: { size: customerQuotaBytes() } });

    const result = await checkUploadQuota({
      userId: "u1",
      customerId: "c1",
      size: 1,
    });

    expect(result).toMatchObject({
      allowed: false,
      scope: "customer",
      limitBytes: customerQuotaBytes(),
    });
  });
});
