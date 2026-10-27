import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { branding: { findFirst: vi.fn() } },
  sendMail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.prisma }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail }) },
}));

import { sendInviteEmail } from "./email";

const email = "kari.hemmelig@example.test";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SMTP_USER = "smtp@example.test";
  process.env.SMTP_PASS = "hemmelig";
  mocks.prisma.branding.findFirst.mockResolvedValue(null);
  mocks.sendMail.mockResolvedValue({});
});

afterEach(() => {
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  vi.restoreAllMocks();
});

describe("e-postlogger", () => {
  it("logger ikke mottakeradressen ved vellykket sending", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sendInviteEmail(email, "Kari", "https://example.test/invite");

    const output = log.mock.calls.flat().join(" ");
    expect(output).not.toContain(email);
    expect(output).not.toContain("example.test");
  });

  it("logger ikke rå SMTP-feil som kan inneholde adressen", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.sendMail.mockRejectedValue(
      new Error(`550 mottaker ${email} avvist`),
    );

    const result = await sendInviteEmail(email, "Kari", "https://example.test/invite");

    expect(result).toBe(false);
    const output = error.mock.calls.flat().join(" ");
    expect(output).not.toContain(email);
    expect(output).not.toContain("550 mottaker");
  });
});
