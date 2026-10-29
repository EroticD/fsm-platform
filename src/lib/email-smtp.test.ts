import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
}));

vi.mock("@/lib/prisma", () => ({
  default: { branding: { findFirst: vi.fn() } },
}));
vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));

import { createSmtpTransport } from "./email";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.SMTP_SECURE;
});

describe("createSmtpTransport", () => {
  it("krever STARTTLS og minst TLS 1.2", () => {
    createSmtpTransport();

    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
        tls: { minVersion: "TLSv1.2" },
      }),
    );
  });

  it("beholder implicit TLS på port 465", () => {
    process.env.SMTP_SECURE = "true";
    createSmtpTransport();

    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, requireTLS: true }),
    );
  });
});
